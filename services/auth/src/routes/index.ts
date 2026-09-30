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
import type { SessionService } from '../sessions/session-service.js';
import type { SignInResult, UserService } from '../users/user-service.js';
import {
  DevSignInBody,
  OAuthSignInBody,
  PushTokenBody,
  PushTokenParams,
  RefreshTokenBody,
  SessionIdParams,
  SetPhoneBody,
  UpdateMeBody,
} from './schemas.js';
import type { JwtVerifier } from '@buku/common';

export interface RouteDeps {
  users: UserService;
  sessions: SessionService;
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

  app.use('/v1/auth', r);
}
