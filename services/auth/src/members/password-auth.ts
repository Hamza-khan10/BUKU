import { randomInt } from 'node:crypto';
import {
  AppError,
  ErrorCodes,
  getDummyPasswordHash,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '@buku/common';
import { recordAudit, type Database } from '@buku/database';
import type { RequestContext } from '../http/context.js';
import { auditCtx, type DeviceInfo, type SessionService } from '../sessions/session-service.js';
import type { SignInResult, UserService } from '../users/user-service.js';

/**
 * Password sign-in for employee accounts (D-034): business + username +
 * password, for staff phones and shared tablets.
 *
 *  • Wrong business, wrong username and wrong password all give the same
 *    answer in about the same time, so the form can't be used to discover
 *    which accounts exist.
 *  • After `maxAttempts` wrong passwords in a row the account is locked for
 *    `lockoutMinutes`. Locked accounts don't even check the password, so a
 *    guesser gains nothing by continuing. The business can unlock at once by
 *    resetting the password.
 *  • A business-issued (temporary) password must be replaced before the
 *    account gets any business access (see `businessRoleOf`).
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
      db: Database;
      users: UserService;
      sessions: SessionService;
      settings: PasswordAuthSettings;
    },
  ) {}

  async signIn(input: PasswordSignInInput, ctx: RequestContext): Promise<SignInResult> {
    const { db } = this.deps;
    const business = await db.business.findFirst({
      where: { slug: input.business, deletedAt: null },
      select: { id: true },
    });
    const account = business
      ? await db.user.findFirst({ where: { managedByBusinessId: business.id, username: input.username } })
      : null;
    if (!business || !account?.passwordHash) {
      await verifyPassword(input.password, await getDummyPasswordHash()); // same timing as a real check
      throw invalidCredentials();
    }

    if (account.lockedUntil && account.lockedUntil > new Date()) throw locked(account.lockedUntil);
    if (!(await verifyPassword(input.password, account.passwordHash))) {
      const lockedUntil = await this.recordFailure(account.id, ctx);
      throw lockedUntil ? locked(lockedUntil) : invalidCredentials();
    }

    // Only someone who knows the password learns that access was turned off.
    const membership = await db.businessMember.findFirst({
      where: { businessId: business.id, userId: account.id },
      select: { status: true },
    });
    if (account.status !== 'active' || membership?.status !== 'active') {
      throw new AppError(
        'Your access to this business is turned off. Please speak to the business owner.',
        ErrorCodes.ACCOUNT_SUSPENDED,
        403,
      );
    }

    const user = await db.user.update({
      where: { id: account.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        // Parameters were raised since this hash was made: upgrade it now that we have the password.
        ...(needsRehash(account.passwordHash) && { passwordHash: await hashPassword(input.password) }),
      },
    });
    const session = await this.deps.sessions.start(user, input.device ?? {}, ctx);
    await recordAudit(db, {
      userId: user.id,
      action: 'auth.member_signed_in',
      resourceType: 'user',
      resourceId: user.id,
      newValues: { businessId: business.id },
      ...auditCtx(ctx),
    });
    return { user: this.deps.users.toMe(user), isNewUser: false, session };
  }

  /** Change one's own password. Every session of the account ends, this one included. */
  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
    ctx: RequestContext,
  ): Promise<void> {
    const { db } = this.deps;
    const user = await db.user.findUnique({ where: { id: userId } });
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
      await recordAudit(tx, {
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

  /**
   * One more wrong password, counted atomically (parallel guesses can't slip
   * past the limit). Returns the lock expiry if this attempt locked the account.
   */
  private async recordFailure(userId: string, ctx: RequestContext): Promise<Date | null> {
    const { maxAttempts, lockoutMinutes } = this.deps.settings;
    const [row] = await this.deps.db.$queryRaw<{ locked_until: Date | null }[]>`
      UPDATE users SET
        failed_login_count = CASE WHEN failed_login_count + 1 >= ${maxAttempts}::int
                                  THEN 0 ELSE failed_login_count + 1 END,
        locked_until = CASE WHEN failed_login_count + 1 >= ${maxAttempts}::int
                            THEN now() + make_interval(mins => ${lockoutMinutes}::int) ELSE locked_until END
      WHERE id = ${userId}::uuid
      RETURNING locked_until`;
    const lockedUntil = row?.locked_until && row.locked_until > new Date() ? row.locked_until : null;
    await recordAudit(this.deps.db, {
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
