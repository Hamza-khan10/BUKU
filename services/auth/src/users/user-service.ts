import {
  AppError,
  ErrorCodes,
  normalizeEmail,
  normalizePhone,
  sanitizeText,
  type BlindIndexer,
  type FieldCipher,
} from '@buku/common';
import { isUniqueViolation, recordAudit, type Database, type User } from '@buku/database';
import { createEvent, enqueueEvent, TOPICS } from '@buku/kafka';
import type { MediaLinks } from '@buku/media';
import type { VerifiedIdentity } from '../identity/oidc.js';
import type { RequestContext } from '../http/context.js';
import {
  auditCtx,
  type DeviceInfo,
  type SessionService,
  type SessionTokens,
} from '../sessions/session-service.js';

/**
 * Accounts and profile. Contact details are stored encrypted (AES-256-GCM)
 * with a keyed blind index for lookups; only the owner of the account ever
 * sees them decrypted (see `toMe`).
 */

export const CONTEXT = {
  email: 'users.email',
  phone: 'users.phone',
  unverifiedPhone: 'users.unverified_phone',
} as const;

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
  session: SessionTokens;
}

export interface UserServiceDeps {
  db: Database;
  cipher: FieldCipher;
  indexer: BlindIndexer;
  sessions: SessionService;
  /** Signed links to private pictures. */
  links: MediaLinks;
  termsVersion: string;
  deletionGraceDays: number;
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
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.signInOnce(identity, input, ctx);
      } catch (err) {
        // Two simultaneous first sign-ins for the same person: the loser retries and finds the account.
        if (attempt < 2 && isUniqueViolation(err)) continue;
        throw err;
      }
    }
  }

  private async signInOnce(
    identity: VerifiedIdentity,
    input: SignInInput,
    ctx: RequestContext,
  ): Promise<SignInResult> {
    const { db, sessions } = this.deps;
    const emailHash =
      identity.email && identity.emailVerified
        ? this.deps.indexer.hash(CONTEXT.email, normalizeEmail(identity.email))
        : null;

    const linked = await db.oAuthAccount.findUnique({
      where: { provider_providerUserId: { provider: identity.provider, providerUserId: identity.subject } },
      select: { userId: true },
    });
    let user: User | null = linked
      ? await db.user.findFirst({ where: { id: linked.userId, deletedAt: undefined } })
      : null;

    if (!user && emailHash) {
      const byEmail = await db.user.findFirst({ where: { emailHash, deletedAt: undefined } });
      if (byEmail?.emailVerifiedAt) {
        this.assertNotBlocked(byEmail, input);
        await db.$transaction(async (tx) => {
          await tx.oAuthAccount.create({
            data: { userId: byEmail.id, provider: identity.provider, providerUserId: identity.subject },
          });
          await recordAudit(tx, {
            userId: byEmail.id,
            action: 'auth.provider_linked',
            resourceType: 'user',
            resourceId: byEmail.id,
            newValues: { provider: identity.provider },
            ...auditCtx(ctx),
          });
        });
        user = byEmail;
      }
    }

    if (user) {
      this.assertNotBlocked(user, input);
      const restoring = user.deletedAt !== null;
      const updated = await db.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), ...(restoring && { deletedAt: null }) },
      });
      if (restoring) {
        await recordAudit(db, {
          userId: user.id,
          action: 'user.deletion_cancelled',
          resourceType: 'user',
          resourceId: user.id,
          ...auditCtx(ctx),
        });
      }
      const session = await sessions.start(updated, input.device ?? {}, ctx);
      await recordAudit(db, {
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
    const name = sanitizeText(identity.name ?? '').slice(0, 200) || email.split('@')[0]!.slice(0, 200);
    const now = new Date();

    const { created, session } = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name,
          emailEncrypted: this.deps.cipher.encrypt(email, CONTEXT.email),
          emailHash,
          emailVerifiedAt: now,
          avatarUrl: identity.pictureUrl,
          timezone: input.timezone ?? 'UTC',
          locale: input.locale ?? 'en',
          termsVersion: this.deps.termsVersion,
          termsAcceptedAt: now,
          lastLoginAt: now,
          oauthAccounts: { create: { provider: identity.provider, providerUserId: identity.subject } },
          notificationPrefs: { create: {} },
        },
      });
      await enqueueEvent(
        tx,
        createEvent({
          type: TOPICS.USERS_REGISTERED,
          source: 'auth-service',
          subject: created.id,
          // No contact details in events: consumers that need them ask auth-service.
          data: {
            userId: created.id,
            provider: identity.provider,
            locale: created.locale,
            timezone: created.timezone,
          },
          ...(ctx.requestId && { correlationId: ctx.requestId }),
        }),
        'user',
      );
      await recordAudit(tx, {
        userId: created.id,
        action: 'auth.signed_up',
        resourceType: 'user',
        resourceId: created.id,
        newValues: { provider: identity.provider, termsVersion: this.deps.termsVersion },
        ...auditCtx(ctx),
      });
      const session = await this.deps.sessions.start(created, input.device ?? {}, ctx, tx);
      return { created, session };
    });

    return { user: await this.toMe(created), isNewUser: true, session };
  }

  /**
   * DEVELOPMENT ONLY (the route is not even registered unless
   * AUTH_DEV_LOGIN_ENABLED, which config refuses in production): sign in as
   * any email with any role, so the platform can be built and tested without
   * real Google/Apple credentials.
   */
  async signInDev(
    input: { email: string; name?: string | undefined; role: 'user' | 'business_owner' | 'super_admin' },
    device: DeviceInfo,
    ctx: RequestContext,
  ): Promise<SignInResult> {
    const email = normalizeEmail(input.email);
    const emailHash = this.deps.indexer.hash(CONTEXT.email, email);
    const existing = await this.deps.db.user.findUnique({ where: { emailHash } });
    const now = new Date();
    const user =
      existing ??
      (await this.deps.db.user.create({
        data: {
          name: input.name ?? email.split('@')[0]!,
          emailEncrypted: this.deps.cipher.encrypt(email, CONTEXT.email),
          emailHash,
          emailVerifiedAt: now,
          role: input.role,
          termsVersion: this.deps.termsVersion,
          termsAcceptedAt: now,
          notificationPrefs: { create: {} },
        },
      }));
    this.assertNotBlocked(user, {});
    const session = await this.deps.sessions.start(user, device, ctx);
    await recordAudit(this.deps.db, {
      userId: user.id,
      action: 'auth.dev_signed_in',
      resourceType: 'user',
      resourceId: user.id,
      ...auditCtx(ctx),
    });
    return { user: await this.toMe(user), isNewUser: !existing, session };
  }

  async getMe(userId: string): Promise<MeView> {
    const user = await this.deps.db.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('User', ErrorCodes.USER_NOT_FOUND);
    return await this.toMe(user);
  }

  async updateProfile(
    userId: string,
    changes: { name?: string | undefined; timezone?: string | undefined; locale?: string | undefined },
    ctx: RequestContext,
  ): Promise<MeView> {
    const data = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    const user = await this.deps.db.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data });
      await recordAudit(tx, {
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
    userId: string,
    input: { phone: string; whatsappOptIn: boolean },
    ctx: RequestContext,
  ): Promise<MeView> {
    const phone = normalizePhone(input.phone);
    const current = await this.deps.db.user.findUnique({
      where: { id: userId },
      select: { whatsappOptInAt: true, phoneHash: true },
    });
    if (!current) throw AppError.notFound('User', ErrorCodes.USER_NOT_FOUND);
    // Re-entering the number that is already verified keeps it verified;
    // any other number becomes the (unverified) number we contact from now on.
    const isVerifiedNumber = current.phoneHash === this.deps.indexer.hash(CONTEXT.phone, phone);
    const user = await this.deps.db.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          unverifiedPhoneEncrypted: isVerifiedNumber
            ? null
            : this.deps.cipher.encrypt(phone, CONTEXT.unverifiedPhone),
          unverifiedPhoneHash: isVerifiedNumber
            ? null
            : this.deps.indexer.hash(CONTEXT.unverifiedPhone, phone),
          // Keep the ORIGINAL consent time if consent was already given (evidence for WhatsApp policy).
          whatsappOptInAt: input.whatsappOptIn ? (current.whatsappOptInAt ?? new Date()) : null,
        },
      });
      await recordAudit(tx, {
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

  /** Register a device for push notifications. A token moving to a new account follows the device. */
  async registerPushToken(userId: string, token: string, platform: 'ios' | 'android' | 'web'): Promise<void> {
    await this.deps.db.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, isActive: true, lastSeenAt: new Date() },
    });
  }

  /** Returns false if the token doesn't belong to this user (never touch other users' devices). */
  async removePushToken(userId: string, token: string): Promise<boolean> {
    const { count } = await this.deps.db.pushToken.deleteMany({ where: { userId, token } });
    return count > 0;
  }

  /**
   * The signed-in user's own view of their account: the ONLY place contact
   * details are decrypted and the only way to the profile picture (D-051),
   * through a 1-hour signed link to the private bucket.
   */
  async toMe(user: User): Promise<MeView> {
    const { cipher } = this.deps;
    // The most recently entered number wins: an unverified number exists only
    // if the user entered one different from their verified number.
    const phone = user.unverifiedPhoneEncrypted
      ? { number: cipher.decrypt(user.unverifiedPhoneEncrypted, CONTEXT.unverifiedPhone), verified: false }
      : user.phoneEncrypted
        ? { number: cipher.decrypt(user.phoneEncrypted, CONTEXT.phone), verified: true }
        : null;
    return {
      id: user.id,
      name: user.name,
      email: user.emailEncrypted ? cipher.decrypt(user.emailEncrypted, CONTEXT.email) : null,
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
            businessId: user.managedByBusinessId,
            username: user.username,
            mustChangePassword: user.mustChangePassword,
          }
        : { type: 'personal' },
      createdAt: user.createdAt.toISOString(),
      // Employee accounts belong to the business: no personal phone is asked for.
      onboarding: { phoneRequired: phone === null && !user.managedByBusinessId },
    };
  }

  /**
   * Suspended accounts can't sign in. Accounts pending deletion can only sign
   * in by explicitly restoring (the app offers "Restore my account").
   * Deletion never changes `status`, so restoring can't lift a suspension.
   */
  private assertNotBlocked(user: User, input: Pick<SignInInput, 'restoreAccount'>): void {
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

export interface MeView {
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
    | { type: 'employee'; businessId: string; username: string | null; mustChangePassword: boolean };
  createdAt: string;
  onboarding: { phoneRequired: boolean };
}
