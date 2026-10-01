import {
  AppError,
  authenticate,
  ErrorCodes,
  rateLimit,
  requireAuth,
  sendNoContent,
  sendSuccess,
  validated,
  type RevocationStore,
} from '@buku/common';
import { Router, type Express } from 'express';
import type { Redis } from 'ioredis';
import { requestContext } from '../http/context.js';
import type { OidcVerifier } from '../identity/oidc.js';
import type { MemberService } from '../members/member-service.js';
import type { PasswordAuthService } from '../members/password-auth.js';
import type { SessionService } from '../sessions/session-service.js';
import type { AvatarService } from '../users/avatar-service.js';
import type { DataRightsService } from '../users/data-rights.js';
import type { SignInResult, UserService } from '../users/user-service.js';
import {
  AvatarUploadBody,
  BusinessParams,
  BusinessSignInBody,
  ChangePasswordBody,
  CreateMemberBody,
  DeleteAccountBody,
  DevSignInBody,
  MemberParams,
  OAuthSignInBody,
  PushTokenBody,
  PushTokenParams,
  RefreshTokenBody,
  SessionIdParams,
  SetPhoneBody,
  UploadIdParams,
  UpdateMeBody,
  UpdateMemberBody,
} from './schemas.js';
import type { JwtVerifier } from '@buku/common';

export interface RouteDeps {
  users: UserService;
  sessions: SessionService;
  rights: DataRightsService;
  passwords: PasswordAuthService;
  members: MemberService;
  avatars: AvatarService;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  redis: Redis;
  identity: { google: OidcVerifier | null; apple: OidcVerifier | null };
  devLoginEnabled: boolean;
}

function signInResponse(result: SignInResult) {
  return { user: result.user, isNewUser: result.isNewUser, ...result.session };
}

export function registerRoutes(app: Express, deps: RouteDeps): void {
  const r = Router();
  const auth = authenticate({ verifier: deps.verifier, isRevoked: (t) => deps.revocations.isRevoked(t) });
  // Per-IP limits on unauthenticated endpoints (the gateway adds a coarse limit on top).
  const signInLimit = rateLimit({
    keyPrefix: 'rl:auth:signin',
    points: 10,
    durationSeconds: 60,
    redis: deps.redis,
  });
  const refreshLimit = rateLimit({
    keyPrefix: 'rl:auth:refresh',
    points: 60,
    durationSeconds: 60,
    redis: deps.redis,
  });
  const writeLimit = rateLimit({
    keyPrefix: 'rl:auth:write',
    points: 30,
    durationSeconds: 60,
    redis: deps.redis,
  });

  // ── Sign in ──────────────────────────────────────────────────────────────
  for (const provider of ['google', 'apple'] as const) {
    r.post(
      `/oauth/${provider}`,
      signInLimit,
      validated({ body: OAuthSignInBody }, async ({ body }, req, res) => {
        const verifier = deps.identity[provider];
        if (!verifier) {
          throw new AppError(
            `Sign in with ${provider === 'google' ? 'Google' : 'Apple'} is not available yet`,
            ErrorCodes.FEATURE_DISABLED,
            403,
          );
        }
        const identity = await verifier.verify(body.idToken);
        const result = await deps.users.signInWithIdentity(identity, body, requestContext(req));
        sendSuccess(res, signInResponse(result), result.isNewUser ? 201 : 200);
      }),
    );
  }

  // Employee accounts: business + username + password (D-034).
  r.post(
    '/business-login',
    signInLimit,
    validated({ body: BusinessSignInBody }, async ({ body }, req, res) => {
      sendSuccess(res, signInResponse(await deps.passwords.signIn(body, requestContext(req))));
    }),
  );

  if (deps.devLoginEnabled) {
    r.post(
      '/dev/login',
      signInLimit,
      validated({ body: DevSignInBody }, async ({ body }, req, res) => {
        const result = await deps.users.signInDev(body, body.device ?? {}, requestContext(req));
        sendSuccess(res, signInResponse(result), result.isNewUser ? 201 : 200);
      }),
    );
  }

  // ── Sessions ─────────────────────────────────────────────────────────────
  r.post(
    '/refresh',
    refreshLimit,
    validated({ body: RefreshTokenBody }, async ({ body }, req, res) => {
      sendSuccess(res, await deps.sessions.refresh(body.refreshToken, requestContext(req)));
    }),
  );

  r.post(
    '/logout',
    refreshLimit,
    validated({ body: RefreshTokenBody }, async ({ body }, req, res) => {
      await deps.sessions.logoutByRefreshToken(body.refreshToken, requestContext(req));
      sendNoContent(res);
    }),
  );

  r.post('/logout-all', auth, writeLimit, async (req, res) => {
    await deps.sessions.endAllSessions(requireAuth(req).userId, 'logged_out_everywhere', requestContext(req));
    sendNoContent(res);
  });

  r.get('/sessions', auth, async (req, res) => {
    const { userId, sessionId } = requireAuth(req);
    const sessions = await deps.sessions.list(userId);
    sendSuccess(
      res,
      sessions.map((s) => ({ ...s, current: s.id === sessionId })),
    );
  });

  r.delete(
    '/sessions/:id',
    auth,
    writeLimit,
    validated({ params: SessionIdParams }, async ({ params }, req, res) => {
      const ended = await deps.sessions.endSession(
        requireAuth(req).userId,
        params.id,
        'revoked_by_user',
        requestContext(req),
      );
      // 404 (not 403) for someone else's session: don't confirm that it exists.
      if (!ended) throw AppError.notFound('Session');
      sendNoContent(res);
    }),
  );

  // ── Me ───────────────────────────────────────────────────────────────────
  r.get('/me', auth, async (req, res) => {
    sendSuccess(res, await deps.users.getMe(requireAuth(req).userId));
  });

  r.patch(
    '/me',
    auth,
    writeLimit,
    validated({ body: UpdateMeBody }, async ({ body }, req, res) => {
      sendSuccess(res, await deps.users.updateProfile(requireAuth(req).userId, body, requestContext(req)));
    }),
  );

  r.put(
    '/me/phone',
    auth,
    writeLimit,
    validated({ body: SetPhoneBody }, async ({ body }, req, res) => {
      sendSuccess(res, await deps.users.setPhone(requireAuth(req).userId, body, requestContext(req)));
    }),
  );

  // Profile picture: private, only ever shown to the user themself (D-051).
  r.post(
    '/me/avatar/uploads',
    auth,
    writeLimit,
    validated({ body: AvatarUploadBody }, async ({ body }, req, res) => {
      sendSuccess(res, await deps.avatars.requestUpload(requireAuth(req).userId, body), 201);
    }),
  );
  r.post(
    '/me/avatar/uploads/:uploadId/complete',
    auth,
    writeLimit,
    validated({ params: UploadIdParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.avatars.completeUpload(requireAuth(req).userId, params.uploadId, requestContext(req)),
      );
    }),
  );
  r.delete('/me/avatar', auth, writeLimit, async (req, res) => {
    sendSuccess(res, await deps.avatars.remove(requireAuth(req).userId, requestContext(req)));
  });

  r.post(
    '/push-tokens',
    auth,
    writeLimit,
    validated({ body: PushTokenBody }, async ({ body }, req, res) => {
      await deps.users.registerPushToken(requireAuth(req).userId, body.token, body.platform);
      sendNoContent(res);
    }),
  );

  r.delete(
    '/push-tokens/:token',
    auth,
    writeLimit,
    validated({ params: PushTokenParams }, async ({ params }, req, res) => {
      if (!(await deps.users.removePushToken(requireAuth(req).userId, params.token)))
        throw AppError.notFound('Push token');
      sendNoContent(res);
    }),
  );

  // Every session ends, this one included: the app signs in again with the new password.
  r.post(
    '/password',
    auth,
    writeLimit,
    validated({ body: ChangePasswordBody }, async ({ body }, req, res) => {
      await deps.passwords.changePassword(requireAuth(req).userId, body, requestContext(req));
      sendSuccess(res, { signInAgain: true });
    }),
  );

  // ── My data (export / delete) ────────────────────────────────────────────
  const exportLimit = rateLimit({
    keyPrefix: 'rl:auth:export',
    points: 5,
    durationSeconds: 3600,
    redis: deps.redis,
  });

  r.get('/me/export', auth, exportLimit, async (req, res) => {
    const data = await deps.rights.exportData(requireAuth(req).userId, requestContext(req));
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="buku-data-export-${day}.json"`);
    sendSuccess(res, data);
  });

  r.delete(
    '/me',
    auth,
    writeLimit,
    validated({ body: DeleteAccountBody }, async ({ body }, req, res) => {
      const { userId, sessionId } = requireAuth(req);
      const result = await deps.rights.requestDeletion(userId, sessionId, body.reason, requestContext(req));
      sendSuccess(res, { status: 'scheduled', ...result }, 202);
    }),
  );

  app.use('/v1/auth', r);

  // ── A business's team (employee accounts and roles) ──────────────────────
  const team = Router({ mergeParams: true });
  team.use(auth, writeLimit);

  team.get(
    '/',
    validated({ params: BusinessParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.members.list(params.businessId, requireAuth(req).userId));
    }),
  );

  team.post(
    '/',
    validated({ params: BusinessParams, body: CreateMemberBody }, async ({ params, body }, req, res) => {
      const result = await deps.members.create(
        params.businessId,
        requireAuth(req).userId,
        body,
        requestContext(req),
      );
      sendSuccess(res, result, 201);
    }),
  );

  team.patch(
    '/:memberId',
    validated({ params: MemberParams, body: UpdateMemberBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.members.update(
          params.businessId,
          params.memberId,
          requireAuth(req).userId,
          body,
          requestContext(req),
        ),
      );
    }),
  );

  team.post(
    '/:memberId/reset-password',
    validated({ params: MemberParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.members.resetPassword(
          params.businessId,
          params.memberId,
          requireAuth(req).userId,
          requestContext(req),
        ),
      );
    }),
  );

  team.delete(
    '/:memberId',
    validated({ params: MemberParams }, async ({ params }, req, res) => {
      await deps.members.remove(
        params.businessId,
        params.memberId,
        requireAuth(req).userId,
        requestContext(req),
      );
      sendNoContent(res);
    }),
  );

  app.use('/v1/businesses/:businessId/members', team);
}
