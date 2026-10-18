import { randomInt } from 'node:crypto';
import {
  AppError,
  ErrorCodes,
  getDummyPasswordHash,
  hashPassword,
  needsRehash,
  verifyPassword,
  recordSecurityEvent,
} from '@buku/common';
import {
  employeeLoginKey,
  recordShardAudit,
  ShardNotFoundError,
  type DataPlane,
  type UserShard,
} from '@buku/database';
import { auditCtx, auditPerson } from '../audit.js';
import type { RequestContext } from '../http/context.js';
import type { MfaService } from '../mfa/mfa-service.js';
import type { DeviceInfo, SessionService } from '../sessions/session-service.js';
import { sessionUserOf, type SignInResult, type UserService } from '../users/user-service.js';
import type { BreachedPasswords } from './breached-passwords.js';

/**
 * Password sign-in for employee accounts (D-034): business + username +
 * password, for staff phones and shared tablets. The business is found by its address (the
 * `business.slug` handle), the account by the business and username (`user.employee_login`),
 * the membership on the business's shard (database v2, D3).
 *
 *  • Wrong business, wrong username and wrong password all give the same
 *    answer in about the same time, so the form can't be used to discover
 *    which accounts exist.
 *  • After `maxAttempts` wrong passwords in a row the account is locked for
 *    `lockoutMinutes`. Locked accounts don't even check the password, so a
 *    guesser gains nothing by continuing. The business can unlock at once by
 *    resetting the password.
 *  • A business-issued (temporary) password must be replaced before the
 *    account gets any business access: its tokens say so (`pwc`), and
 *    `requireBusinessPermissionOnShard` gives it no role until then.
 *  • Changing the password signs the account out on EVERY device, this one
 *    included (D-029); the app then signs in with the new password.
 */

export interface PasswordAuthSettings {
  maxAttempts: number;
  lockoutMinutes: number;
}

export interface PasswordSignInInput {
  business: string;
  username: string;
  password: string;
  device?: DeviceInfo | undefined;
}

export class PasswordAuthService {
  constructor(
    private readonly deps: {
      plane: DataPlane;
      users: UserService;
      sessions: SessionService;
      mfa: Pick<MfaService, 'beginSession'>;
      /** New passwords are checked against known data breaches. */
      breaches: BreachedPasswords;
      settings: PasswordAuthSettings;
    },
  ) {}

  async signIn(input: PasswordSignInInput, ctx: RequestContext): Promise<SignInResult> {
    const { plane } = this.deps;
    const businessId = await plane.handles.find('business.slug', Buffer.from(input.business, 'utf8'));
    const account = businessId === null ? null : await this.employee(businessId, input.username);
    if (businessId === null || !account?.passwordHash) {
      await verifyPassword(input.password, await getDummyPasswordHash()); // same timing as a real check
      throw invalidCredentials();
    }

    if (account.lockedUntil && account.lockedUntil > new Date()) throw locked(account.lockedUntil);
    if (!(await verifyPassword(input.password, account.passwordHash))) {
      const lockedUntil = await this.recordFailure(account.id, ctx);
      if (lockedUntil) recordSecurityEvent('member_locked_out');
      throw lockedUntil ? locked(lockedUntil) : invalidCredentials();
    }

    // Only someone who knows the password learns that access was turned off.
    const membership = await plane.inBusiness(businessId, (tx) =>
      tx.businessMember.findFirst({
        where: { businessId, userId: account.id, business: { deletedAt: null } },
        select: { status: true },
      }),
    );
    if (account.status !== 'active' || membership?.status !== 'active') {
      throw new AppError(
        'Your access to this business is turned off. Please speak to the business owner.',
        ErrorCodes.ACCOUNT_SUSPENDED,
        403,
      );
    }

    const user = await (
      await plane.user(account.id)
    ).user.update({
      where: { id: account.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        // Parameters were raised since this hash was made: upgrade it now that we have the password.
        ...(needsRehash(account.passwordHash) && { passwordHash: await hashPassword(input.password) }),
      },
    });
    const session = await this.deps.mfa.beginSession(sessionUserOf(user), input.device ?? {}, ctx);
    await auditPerson(plane, user.id, {
      userId: user.id,
      action: 'auth.member_signed_in',
      resourceType: 'user',
      resourceId: user.id,
      newValues: { businessId: businessId.toString() },
      ...auditCtx(ctx),
    });
    return { user: await this.deps.users.toMe(user), isNewUser: false, session };
  }

  /** Change one's own password. Every session of the account ends, this one included. */
  async changePassword(
    userId: bigint,
    input: { currentPassword: string; newPassword: string },
    ctx: RequestContext,
  ): Promise<void> {
    const db = await this.deps.plane.user(userId);
    const user = await db.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw AppError.notFound('User', ErrorCodes.USER_NOT_FOUND);
    if (!user.passwordHash) {
      throw AppError.conflict('This account signs in with Google or Apple and has no password');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw locked(user.lockedUntil);
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      // Counts towards the lockout: a stolen session must not become a password-guessing oracle.
      const lockedUntil = await this.recordFailure(user.id, ctx);
      if (lockedUntil) throw locked(lockedUntil);
      throw new AppError('Your current password is incorrect', ErrorCodes.INVALID_CREDENTIALS, 403);
    }
    if (input.newPassword === input.currentPassword) {
      throw new AppError(
        'Choose a password different from the current one',
        ErrorCodes.PASSWORD_TOO_WEAK,
        422,
      );
    }
    if (user.username && input.newPassword.toLowerCase().includes(user.username)) {
      throw new AppError('Your password must not contain your username', ErrorCodes.PASSWORD_TOO_WEAK, 422);
    }
    // Known to attackers if it was in a breach. If the check can't be reached, the password is
    // allowed (the owner's choice: nobody is stuck); our own rules have already been applied.
    const seen = await this.deps.breaches.timesSeen(input.newPassword);
    if (seen === null) recordSecurityEvent('breach_check_unavailable');
    else if (seen > 0) {
      throw new AppError(
        'This password has appeared in a data breach, so attackers try it first. Please choose another.',
        ErrorCodes.PASSWORD_BREACHED,
        422,
      );
    }

    const passwordHash = await hashPassword(input.newPassword);
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await recordShardAudit(tx, this.deps.plane.id(), {
        userId,
        action: 'auth.password_changed',
        resourceType: 'user',
        resourceId: userId,
        newValues: { wasTemporary: user.mustChangePassword },
        ...auditCtx(ctx),
      });
      await this.deps.sessions.endAllSessions(userId, 'password_changed', ctx, tx);
    });
  }

  /** The business's employee account with this username, if there is one. */
  private async employee(businessId: bigint, username: string): Promise<UserShard.User | null> {
    const { plane } = this.deps;
    const owner = await plane.handles.find('user.employee_login', employeeLoginKey(businessId, username));
    if (owner === null) return null;
    try {
      return await (
        await plane.user(owner)
      ).user.findFirst({
        where: { id: owner, managedByBusinessId: businessId, username, deletedAt: null },
      });
    } catch (err) {
      if (err instanceof ShardNotFoundError) return null;
      throw err;
    }
  }

  /**
   * One more wrong password, counted atomically (parallel guesses can't slip
   * past the limit). Returns the lock expiry if this attempt locked the account.
   */
  private async recordFailure(userId: bigint, ctx: RequestContext): Promise<Date | null> {
    const { maxAttempts, lockoutMinutes } = this.deps.settings;
    const [row] = await (
      await this.deps.plane.user(userId)
    ).$queryRaw<{ locked_until: Date | null }[]>`
      UPDATE users SET
        failed_login_count = CASE WHEN failed_login_count + 1 >= ${maxAttempts}::int
                                  THEN 0 ELSE failed_login_count + 1 END,
        locked_until = CASE WHEN failed_login_count + 1 >= ${maxAttempts}::int
                            THEN now() + make_interval(mins => ${lockoutMinutes}::int) ELSE locked_until END
      WHERE id = ${userId}
      RETURNING locked_until`;
    const lockedUntil = row?.locked_until && row.locked_until > new Date() ? row.locked_until : null;
    await auditPerson(this.deps.plane, userId, {
      userId,
      action: lockedUntil ? 'auth.account_locked' : 'auth.password_failed',
      resourceType: 'user',
      resourceId: userId,
      ...auditCtx(ctx),
    });
    return lockedUntil;
  }
}

/**
 * A temporary password the business hands to an employee (shown once):
 * 16 characters from an alphabet without look-alikes (no 0/o, 1/l/i),
 * about 79 bits of randomness, e.g. "k7mp-x3qa-9wte-hn4c".
 */
export function generateTemporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(''),
  );
  return groups.join('-');
}

function invalidCredentials(): AppError {
  return new AppError('Business, username or password is incorrect', ErrorCodes.INVALID_CREDENTIALS, 401);
}

function locked(until: Date): AppError {
  const retryAfterSeconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
  return new AppError(
    'Too many wrong passwords. Try again later, or ask the business owner to reset your password.',
    ErrorCodes.ACCOUNT_LOCKED,
    429,
    { details: { retryAfterSeconds } },
  );
}
