import {
  AppError,
  ErrorCodes,
  normalizeEmail,
  normalizePhone,
  publicId,
  sanitizeText,
  stripDisallowed,
  type BlindIndexer,
  type FieldCipher,
  type Role,
} from '@buku/common';
import {
  isUniqueViolation,
  recordShardAudit,
  ShardNotFoundError,
  type DataPlane,
  type UserShard,
  type UserShardClient,
} from '@buku/database';
import { createEvent, enqueueShardEvent, TOPICS } from '@buku/kafka';
import type { MediaLinks } from '@buku/media';
import { auditCtx, auditPerson } from '../audit.js';
import type { VerifiedIdentity } from '../identity/oidc.js';
import type { RequestContext } from '../http/context.js';
import type { MfaChallenge, MfaService } from '../mfa/mfa-service.js';
import type { DeviceInfo, SessionService, SessionTokens } from '../sessions/session-service.js';

/**
 * Accounts and profile, on each person's own user shard (database v2, D3). Contact details are
 * stored encrypted (AES-256-GCM) with a keyed blind index; the global handles (DB-018) make an
 * email, a sign-in account or a device one person's across every shard, and find them. Only the
 * owner of the account ever sees their details decrypted (see `toMe`).
 */

export const CONTEXT = {
  email: 'users.email',
  phone: 'users.phone',
  unverifiedPhone: 'users.unverified_phone',
} as const;

/** Blind-index contexts of the other handles' keys (DB-008): a provider's subject, a device's token. */
const SUBJECT_CONTEXT = { google: 'oauth_accounts.google', apple: 'oauth_accounts.apple' } as const;
const PUSH_TOKEN_CONTEXT = 'push_tokens.token';

/** The `user.push_token` handle's key for a device token. */
export const pushTokenKey = (indexer: BlindIndexer, token: string) =>
  indexer.digest16(PUSH_TOKEN_CONTEXT, token);

/** Most characters a stored name may have (users.name is VARCHAR(200)). */
const MAX_NAME = 200;

/**
 * A new account's display name. It comes from the account provider, not
 * from our form, so what our rules don't allow (emoji, invisible characters,
 * digits…) is removed rather than refused (D-083). With nothing left, the
 * email's local part ("ayesha.khan92" → "ayesha khan"); the person confirms
 * or changes it on the welcome screen.
 */
export function displayNameFor(providerName: string | null | undefined, email: string): string {
  const clean = (s: string) =>
    [...stripDisallowed(sanitizeText(s), 'personName')].slice(0, MAX_NAME).join('').trim();
  return clean(providerName ?? '') || clean(email.split('@')[0]!.replace(/[._+-]+/g, ' ')) || 'BUKU member';
}

export interface SignInInput {
  acceptedTermsVersion?: string | undefined;
  /** Cancel a pending account deletion by signing in during the grace period. */
  restoreAccount?: boolean | undefined;
  device?: DeviceInfo | undefined;
  timezone?: string | undefined;
  locale?: string | undefined;
}

export interface SignInResult {
  user: MeView;
  isNewUser: boolean;
  /** A session — or, for someone with two-step sign-in, a challenge to answer first (D-081). */
  session: SessionTokens | MfaChallenge;
}

export interface UserServiceDeps {
  plane: DataPlane;
  cipher: FieldCipher;
  indexer: BlindIndexer;
  sessions: SessionService;
  /** Starts sessions for returning people: a challenge first if they use two-step sign-in. */
  mfa: Pick<MfaService, 'beginSession'>;
  /** Signed links to private pictures. */
  links: MediaLinks;
  termsVersion: string;
  deletionGraceDays: number;
}

type DevSignInInput = {
  email: string;
  name?: string | undefined;
  role: 'user' | 'business_owner' | 'super_admin';
};

type User = UserShard.User;

/**
 * Another sign-in for the same person is making their account at this very moment (a double tap,
 * two tabs): one of them holds the handles, the other tries again and finds the account.
 */
class SignInRace extends Error {
  constructor() {
    super('a first sign-in for the same person is in progress');
  }
}

async function firstSignInRace<T>(signIn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await signIn();
    } catch (err) {
      if (!(err instanceof SignInRace || isUniqueViolation(err))) throw err;
      if (attempt >= 5) {
        throw AppError.conflict('Signing in to this account is already in progress; please try again');
      }
      await new Promise((r) => setTimeout(r, 25 * attempt));
    }
  }
}

export class UserService {
  constructor(private readonly deps: UserServiceDeps) {}

  /**
   * Sign in (or sign up) with a verified Google/Apple identity.
   *
   * 1. Known provider account → that user.
   * 2. Otherwise, a user with the same VERIFIED email → link this provider to
   *    them (so Google and Apple sign-in reach the same account). Only done
   *    when both sides verified the email, otherwise an attacker could claim
   *    someone's account by registering their address elsewhere.
   * 3. Otherwise → new account (requires accepting the current Terms).
   */
  async signInWithIdentity(
    identity: VerifiedIdentity,
    input: SignInInput,
    ctx: RequestContext,
  ): Promise<SignInResult> {
    return firstSignInRace(() => this.signInOnce(identity, input, ctx));
  }

  private async signInOnce(
    identity: VerifiedIdentity,
    input: SignInInput,
    ctx: RequestContext,
  ): Promise<SignInResult> {
    const { indexer } = this.deps;
    const subjectKind = `user.${identity.provider}`;
    const subjectHash = indexer.digest16(SUBJECT_CONTEXT[identity.provider], identity.subject);
    const emailHash =
      identity.email && identity.emailVerified
        ? indexer.digest16(CONTEXT.email, normalizeEmail(identity.email))
        : null;

    let user = await this.byHandle(subjectKind, subjectHash);
    if (!user && emailHash) {
      const byEmail = await this.byHandle('user.email', emailHash);
      if (byEmail?.emailVerifiedAt) {
        this.assertNotBlocked(byEmail, input);
        await this.linkProvider(byEmail.id, identity.provider, subjectHash, ctx);
        user = byEmail;
      }
    }

    if (user) {
      this.assertNotBlocked(user, input);
      const restoring = user.deletedAt !== null;
      const updated = await (
        await this.deps.plane.user(user.id)
      ).user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), ...(restoring && { deletedAt: null }) },
      });
      if (restoring) {
        await auditPerson(this.deps.plane, user.id, {
          userId: user.id,
          action: 'user.deletion_cancelled',
          resourceType: 'user',
          resourceId: user.id,
          ...auditCtx(ctx),
        });
      }
      const session = await this.deps.mfa.beginSession(sessionUserOf(updated), input.device ?? {}, ctx);
      await auditPerson(this.deps.plane, user.id, {
        userId: user.id,
        action: 'auth.signed_in',
        resourceType: 'user',
        resourceId: user.id,
        newValues: { provider: identity.provider },
        ...auditCtx(ctx),
      });
      return { user: await this.toMe(updated), isNewUser: false, session };
    }

    // ── New account ──
    if (input.acceptedTermsVersion !== this.deps.termsVersion) {
      throw new AppError(
        `Please accept the Terms of Service and Privacy Policy (version ${this.deps.termsVersion}) to create an account`,
        ErrorCodes.TERMS_NOT_ACCEPTED,
        422,
        { details: { termsVersion: this.deps.termsVersion } },
      );
    }
    if (!identity.email || !emailHash) {
      throw new AppError(
        'Your account provider did not share a verified email address',
        ErrorCodes.OAUTH_TOKEN_INVALID,
        401,
      );
    }

    const email = normalizeEmail(identity.email);
    const now = new Date();
    const { db, created } = await this.createAccount(
      {
        name: displayNameFor(identity.name, email),
        emailEnc: this.deps.cipher.encryptBytes(email, CONTEXT.email),
        emailHash,
        emailVerifiedAt: now,
        avatarUrl: identity.pictureUrl,
        timezone: input.timezone ?? 'UTC',
        locale: input.locale ?? 'en',
        termsVersion: this.deps.termsVersion,
        termsAcceptedAt: now,
        lastLoginAt: now,
      },
      [[subjectKind, subjectHash]],
      { provider: identity.provider, subjectHash },
    );

    const session = await db.$transaction(async (tx) => {
      await enqueueShardEvent(
        tx,
        this.deps.plane.id(),
        createEvent({
          type: TOPICS.USERS_REGISTERED,
          source: 'auth-service',
          subject: created.id.toString(),
          // No contact details in events: consumers that need them ask auth-service.
          data: {
            userId: created.id.toString(),
            provider: identity.provider,
            locale: created.locale,
            timezone: created.timezone,
          },
          ...(ctx.requestId && { correlationId: ctx.requestId }),
        }),
        'user',
      );
      await recordShardAudit(tx, this.deps.plane.id(), {
        userId: created.id,
        action: 'auth.signed_up',
        resourceType: 'user',
        resourceId: created.id,
        newValues: { provider: identity.provider, termsVersion: this.deps.termsVersion },
        ...auditCtx(ctx),
      });
      return this.deps.sessions.start(sessionUserOf(created), input.device ?? {}, ctx, tx);
    });

    return { user: await this.toMe(created), isNewUser: true, session };
  }

  /**
   * DEVELOPMENT ONLY (the route is not even registered unless
   * AUTH_DEV_LOGIN_ENABLED, which config refuses in production): sign in as
   * any email with any role, so the platform can be built and tested without
   * real Google/Apple credentials.
   */
  async signInDev(input: DevSignInInput, device: DeviceInfo, ctx: RequestContext): Promise<SignInResult> {
    return firstSignInRace(() => this.signInDevOnce(input, device, ctx));
  }

  private async signInDevOnce(
    input: DevSignInInput,
    device: DeviceInfo,
    ctx: RequestContext,
  ): Promise<SignInResult> {
    const email = normalizeEmail(input.email);
    const emailHash = this.deps.indexer.digest16(CONTEXT.email, email);
    const existing = await this.byHandle('user.email', emailHash);
    const now = new Date();
    const user =
      existing ??
      (
        await this.createAccount(
          {
            name: input.name ?? displayNameFor(null, email),
            emailEnc: this.deps.cipher.encryptBytes(email, CONTEXT.email),
            emailHash,
            emailVerifiedAt: now,
            role: input.role,
            termsVersion: this.deps.termsVersion,
            termsAcceptedAt: now,
            lastLoginAt: now,
          },
          [],
        )
      ).created;
    this.assertNotBlocked(user, {});
    if (existing) {
      await (
        await this.deps.plane.user(user.id)
      ).user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
    }
    // Development only (refused in production): counts as having passed two-step sign-in,
    // so admin tools can be used locally without an authenticator app.
    const session = await this.deps.sessions.start(sessionUserOf(user), device, ctx, undefined, {
      mfa: true,
    });
    await auditPerson(this.deps.plane, user.id, {
      userId: user.id,
      action: 'auth.dev_signed_in',
      resourceType: 'user',
      resourceId: user.id,
      ...auditCtx(ctx),
    });
    return { user: await this.toMe(user), isNewUser: !existing, session };
  }

  async getMe(userId: bigint): Promise<MeView> {
    return await this.toMe(await this.liveUser(userId));
  }

  async updateProfile(
    userId: bigint,
    changes: { name?: string | undefined; timezone?: string | undefined; locale?: string | undefined },
    ctx: RequestContext,
  ): Promise<MeView> {
    const data = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    const user = await (
      await this.deps.plane.user(userId)
    ).$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId, deletedAt: null }, data });
      await recordShardAudit(tx, this.deps.plane.id(), {
        userId,
        action: 'user.profile_updated',
        resourceType: 'user',
        resourceId: userId,
        newValues: { fields: Object.keys(data) },
        ...auditCtx(ctx),
      });
      return updated;
    });
    return await this.toMe(user);
  }

  /**
   * Phone number for WhatsApp notifications (required after sign-up). Stored
   * as UNVERIFIED until OTP verification exists; see schema comments.
   */
  async setPhone(
    userId: bigint,
    input: { phone: string; whatsappOptIn: boolean },
    ctx: RequestContext,
  ): Promise<MeView> {
    const { cipher, indexer } = this.deps;
    const phone = normalizePhone(input.phone);
    const current = await this.liveUser(userId);
    // Re-entering the number that is already verified keeps it verified;
    // any other number becomes the (unverified) number we contact from now on.
    const isVerifiedNumber =
      current.phoneHash !== null &&
      Buffer.from(current.phoneHash).equals(indexer.digest16(CONTEXT.phone, phone));
    const user = await (
      await this.deps.plane.user(userId)
    ).$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          unverifiedPhoneEnc: isVerifiedNumber ? null : cipher.encryptBytes(phone, CONTEXT.unverifiedPhone),
          unverifiedPhoneHash: isVerifiedNumber ? null : indexer.digest16(CONTEXT.unverifiedPhone, phone),
          // Keep the ORIGINAL consent time if consent was already given (evidence for WhatsApp policy).
          whatsappOptInAt: input.whatsappOptIn ? (current.whatsappOptInAt ?? new Date()) : null,
        },
      });
      await recordShardAudit(tx, this.deps.plane.id(), {
        userId,
        action: 'user.phone_updated',
        resourceType: 'user',
        resourceId: userId,
        newValues: { whatsappOptIn: input.whatsappOptIn, verified: isVerifiedNumber },
        ...auditCtx(ctx),
      });
      return updated;
    });
    return await this.toMe(user);
  }

  /**
   * Register a device for push notifications. A device is one person's at a time (its global
   * handle, DB-018): a token moving to a new account follows the device, and leaves the old one.
   */
  async registerPushToken(userId: bigint, token: string, platform: 'ios' | 'android' | 'web'): Promise<void> {
    const { plane } = this.deps;
    const { previousOwner } = await plane.handles.claim(
      'user.push_token',
      pushTokenKey(this.deps.indexer, token),
      userId,
      true,
    );
    if (previousOwner !== null && previousOwner !== userId) {
      const before = await this.shardOrNull(previousOwner);
      await before?.pushToken.deleteMany({ where: { userId: previousOwner, token } });
    }
    await (
      await plane.user(userId)
    ).pushToken.upsert({
      where: { token },
      create: { id: plane.id(), userId, token, platform },
      update: { userId, platform, isActive: true, lastSeenAt: new Date() },
    });
  }

  /** Returns false if the token doesn't belong to this user (never touch other users' devices). */
  async removePushToken(userId: bigint, token: string): Promise<boolean> {
    const { count } = await (
      await this.deps.plane.user(userId)
    ).pushToken.deleteMany({ where: { userId, token } });
    if (count > 0)
      await this.deps.plane.handles.release(
        'user.push_token',
        pushTokenKey(this.deps.indexer, token),
        userId,
      );
    return count > 0;
  }

  /**
   * The signed-in user's own view of their account: the ONLY place contact
   * details are decrypted and the only way to the profile picture (D-051),
   * through a 1-hour signed link to the private bucket. IDs are public ones (DB-042).
   */
  async toMe(user: User): Promise<MeView> {
    const { cipher } = this.deps;
    // The most recently entered number wins: an unverified number exists only
    // if the user entered one different from their verified number.
    const phone = user.unverifiedPhoneEnc
      ? { number: cipher.decryptBytes(user.unverifiedPhoneEnc, CONTEXT.unverifiedPhone), verified: false }
      : user.phoneEnc
        ? { number: cipher.decryptBytes(user.phoneEnc, CONTEXT.phone), verified: true }
        : null;
    return {
      id: user.publicId,
      name: user.name,
      email: user.emailEnc ? cipher.decryptBytes(user.emailEnc, CONTEXT.email) : null,
      phone,
      whatsappOptIn: user.whatsappOptInAt !== null,
      avatarUrl: user.avatarStorageKey
        ? await this.deps.links.privateUrl(user.avatarStorageKey)
        : user.avatarUrl,
      timezone: user.timezone,
      locale: user.locale,
      role: user.role,
      account: user.managedByBusinessId
        ? {
            type: 'employee',
            businessId: await this.deps.plane.businessPublicId(user.managedByBusinessId),
            username: user.username,
            mustChangePassword: user.mustChangePassword,
          }
        : { type: 'personal' },
      createdAt: user.createdAt.toISOString(),
      // Employee accounts belong to the business: no personal phone is asked for.
      onboarding: { phoneRequired: phone === null && !user.managedByBusinessId },
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** A person who isn't deleted, or 404. */
  private async liveUser(userId: bigint): Promise<User> {
    const db = await this.shardOrNull(userId);
    const user = await db?.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw AppError.notFound('User', ErrorCodes.USER_NOT_FOUND);
    return user;
  }

  private async shardOrNull(userId: bigint): Promise<UserShardClient | null> {
    try {
      return await this.deps.plane.user(userId);
    } catch (err) {
      if (err instanceof ShardNotFoundError) return null;
      throw err;
    }
  }

  /**
   * The person a handle belongs to, deleted or not. An account's row is written before its
   * handles are claimed, so a handle without its row is a first sign-in still in progress.
   */
  private async byHandle(kind: string, key: Buffer): Promise<User | null> {
    const owner = await this.deps.plane.handles.find(kind, key);
    if (owner === null) return null;
    const db = await this.shardOrNull(owner);
    const user = await db?.user.findUnique({ where: { id: owner } });
    if (!user) throw new SignInRace();
    return user;
  }

  /** Link a Google/Apple account to an existing person (their handle first, then their shard). */
  private async linkProvider(
    userId: bigint,
    provider: 'google' | 'apple',
    subjectHash: Buffer<ArrayBuffer>,
    ctx: RequestContext,
  ): Promise<void> {
    const { plane } = this.deps;
    const { claimed } = await plane.handles.claim(`user.${provider}`, subjectHash, userId);
    if (!claimed) throw new SignInRace();
    await (
      await plane.user(userId)
    ).$transaction(async (tx) => {
      // The account's own first sign-in may have written it a moment ago.
      await tx.oAuthAccount.createMany({
        data: [{ id: plane.id(), userId, provider, subjectHash }],
        skipDuplicates: true,
      });
      await recordShardAudit(tx, plane.id(), {
        userId,
        action: 'auth.provider_linked',
        resourceType: 'user',
        resourceId: userId,
        newValues: { provider },
        ...auditCtx(ctx),
      });
    });
  }

  /**
   * A new account: placed on a shard (DB-011), written there, then its handles claimed — the email
   * first, then the sign-in account, then the public ID. If another sign-in got one of them first,
   * everything claimed is given back and the row removed; the caller tries again and finds the
   * winner's account. The row comes first so a handle always leads to an account.
   */
  private async createAccount(
    data: Omit<UserShard.Prisma.UserUncheckedCreateInput, 'id' | 'publicId'> & {
      emailHash: Buffer<ArrayBuffer>;
    },
    handles: [kind: string, key: Buffer<ArrayBuffer>][],
    oauth?: { provider: 'google' | 'apple'; subjectHash: Buffer<ArrayBuffer> },
  ): Promise<{ db: UserShardClient; created: User }> {
    const { plane } = this.deps;
    // New accounts paused by an operator (D-129).
    plane.switches.check('signups');
    const id = plane.id();
    const pid = publicId();
    const db = await plane.placeUser(id);
    const created = await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { ...data, id, publicId: pid } });
      await tx.notificationPreference.create({ data: { userId: id } });
      if (oauth) await tx.oAuthAccount.create({ data: { id: plane.id(), userId: id, ...oauth } });
      return user;
    });
    const claimed: [string, Buffer][] = [];
    try {
      for (const [kind, key] of [
        ['user.email', data.emailHash] as [string, Buffer],
        ...handles,
        ['user.public_id', Buffer.from(pid, 'ascii')] as [string, Buffer],
      ]) {
        if (!(await plane.handles.claim(kind, key, id)).claimed) throw new SignInRace();
        claimed.push([kind, key]);
      }
    } catch (err) {
      for (const [kind, key] of claimed) await plane.handles.release(kind, key, id);
      await db.user.delete({ where: { id } });
      throw err;
    }
    return { db, created };
  }

  /**
   * Suspended accounts can't sign in. Accounts pending deletion can only sign
   * in by explicitly restoring (the app offers "Restore my account").
   * Deletion never changes `status`, so restoring can't lift a suspension.
   */
  private assertNotBlocked(user: User, input: Pick<SignInInput, 'restoreAccount'>): void {
    if (user.purgedAt) throw new AppError('This account was deleted', ErrorCodes.ACCOUNT_SUSPENDED, 403);
    if (user.deletedAt && !input.restoreAccount) {
      const purgeAfter = new Date(user.deletedAt.getTime() + this.deps.deletionGraceDays * 86_400_000);
      throw new AppError('This account is scheduled for deletion', ErrorCodes.ACCOUNT_SUSPENDED, 403, {
        details: { reason: 'account_deleted', canRestore: true, purgeAfter: purgeAfter.toISOString() },
      });
    }
    if (user.status !== 'active') {
      throw new AppError('This account is suspended', ErrorCodes.ACCOUNT_SUSPENDED, 403);
    }
  }
}

/** What a session needs to know about a person. */
export function sessionUserOf(user: Pick<User, 'id' | 'role' | 'mustChangePassword'>) {
  return { id: user.id, role: user.role as Role, mustChangePassword: user.mustChangePassword };
}

export interface MeView {
  /** The public ID (DB-042). */
  id: string;
  name: string;
  email: string | null;
  phone: { number: string; verified: boolean } | null;
  whatsappOptIn: boolean;
  /** Uploaded picture (signed link, valid 1 hour) or the sign-in provider's; only ever shown to the user. */
  avatarUrl: string | null;
  timezone: string;
  locale: string;
  role: string;
  /** Personal (Google/Apple) account, or an employee account created by a business (D-034). */
  account:
    | { type: 'personal' }
    | { type: 'employee'; businessId: string | null; username: string | null; mustChangePassword: boolean };
  createdAt: string;
  onboarding: { phoneRequired: boolean };
}
