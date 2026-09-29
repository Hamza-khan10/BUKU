import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { type z } from 'zod';
import { AppError, ErrorCodes, HttpStatus, isAppError } from '../errors.js';
import { logger as rootLogger } from '../logger.js';
import { errorResponse } from '../response.js';
import type { JwtVerifier, Role, VerifiedAccessToken } from '../security/jwt.js';

// ── Request typing ─────────────────────────────────────────────────────────

export interface AuthContext {
  userId: string;
  role: Role;
  tokenId: string;
  sessionId?: string;
  expiresAt: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's documented augmentation point
  namespace Express {
    interface Request {
      /** Set by `authenticate`; undefined on public routes. */
      auth?: AuthContext;
    }
  }
}

const requestIdOf = (req: Request): string | undefined =>
  typeof req.id === 'string' || typeof req.id === 'number' ? String(req.id) : undefined;

// ── Validation ─────────────────────────────────────────────────────────────

type AnySchema = z.ZodType;
type Out<S> = S extends AnySchema ? z.output<S> : undefined;

export interface RequestSchemas<
  B extends AnySchema | undefined,
  Q extends AnySchema | undefined,
  P extends AnySchema | undefined,
> {
  body?: B;
  query?: Q;
  params?: P;
}

export interface ValidatedInput<B, Q, P> {
  body: Out<B>;
  query: Out<Q>;
  params: Out<P>;
}

function toIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/**
 * Wrap a route handler so its body, query and params are validated first.
 * The handler receives typed, parsed values; the raw `req.body`/`req.query`
 * should not be read. Invalid input never reaches business logic.
 *
 *   router.post('/things', validated({ body: CreateThing }, async ({ body }, req, res) => { ... }))
 */
export function validated<
  B extends AnySchema | undefined = undefined,
  Q extends AnySchema | undefined = undefined,
  P extends AnySchema | undefined = undefined,
>(
  schemas: RequestSchemas<B, Q, P>,
  handler: (input: ValidatedInput<B, Q, P>, req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return async (req, res, next) => {
    const input: Record<string, unknown> = {};
    const issues: { path: string; message: string }[] = [];
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) {
        input[part] = undefined;
        continue;
      }
      const result = await schema.safeParseAsync(req[part] ?? {});
      if (result.success) input[part] = result.data;
      else
        issues.push(
          ...toIssues(result.error).map((i) => ({ ...i, path: i.path ? `${part}.${i.path}` : part })),
        );
    }
    if (issues.length)
      throw new AppError('Request validation failed', ErrorCodes.VALIDATION_ERROR, 400, { details: issues });
    await handler(input as unknown as ValidatedInput<B, Q, P>, req, res, next);
  };
}

// ── Authentication & authorization ─────────────────────────────────────────

export interface AuthenticateOptions {
  verifier: JwtVerifier;
  /** Optional revocation check (e.g. Valkey deny-list of logged-out token ids). */
  isRevoked?: (token: VerifiedAccessToken) => Promise<boolean>;
}

/** Requires a valid `Authorization: Bearer <jwt>`; sets `req.auth`. */
export function authenticate(options: AuthenticateOptions): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();
    const token = header.slice('Bearer '.length).trim();
    if (!token || token.length > 4096)
      throw AppError.unauthorized('Invalid access token', ErrorCodes.TOKEN_INVALID);

    const claims = await options.verifier.verify(token);
    if (options.isRevoked && (await options.isRevoked(claims))) {
      throw AppError.unauthorized('Access token has been revoked', ErrorCodes.TOKEN_REVOKED);
    }
    req.auth = {
      userId: claims.sub,
      role: claims.role,
      tokenId: claims.jti,
      expiresAt: claims.exp,
      ...(claims.sid ? { sessionId: claims.sid } : {}),
    };
    next();
  };
}

/** Role-based access control. Use after `authenticate`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw AppError.unauthorized();
    if (!roles.includes(req.auth.role)) throw AppError.forbidden();
    next();
  };
}

/** Narrow `req.auth` inside handlers that sit behind `authenticate`. */
export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

// ── Errors ─────────────────────────────────────────────────────────────────

/** Express body-parser errors carry a `type`; map them to clean 4xx responses. */
function fromBodyParserError(err: unknown): AppError | undefined {
  if (typeof err !== 'object' || err === null || !('type' in err)) return undefined;
  switch ((err as { type: string }).type) {
    case 'entity.parse.failed':
      return new AppError('Request body is not valid JSON', ErrorCodes.INVALID_JSON, HttpStatus.BAD_REQUEST);
    case 'entity.too.large':
      return new AppError(
        'Request body is too large',
        ErrorCodes.PAYLOAD_TOO_LARGE,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new AppError(
        'Unsupported request encoding',
        ErrorCodes.UNSUPPORTED_MEDIA_TYPE,
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    default:
      return undefined;
  }
}

/**
 * Global error handler — register LAST. Guarantees:
 *  - every error becomes the standard error envelope with the request id;
 *  - unexpected errors are logged with stack + cause, but the client only
 *    sees a generic 500 (no stack traces, SQL, or internal messages leak).
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError = isAppError(err) ? err : (fromBodyParserError(err) ?? AppError.internal(undefined, err));
  const log = req.log ?? rootLogger;

  if (appError.isOperational) {
    log.debug({ code: appError.code, status: appError.httpStatus }, appError.message);
  } else {
    log.error({ err: isAppError(err) ? (err.cause ?? err) : err, code: appError.code }, 'request failed');
  }

  if (appError.code === ErrorCodes.RATE_LIMITED) {
    const retry = (appError.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
    if (retry) res.setHeader('Retry-After', String(retry));
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(appError.httpStatus).json(errorResponse(appError, requestIdOf(req)));
}

/** 404 for unmatched routes — register after all routers, before errorHandler. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(HttpStatus.NOT_FOUND).json(errorResponse(AppError.notFound('Route'), requestIdOf(req)));
}
