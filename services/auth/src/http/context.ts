import { AppError, ErrorCodes, idFromString, requireAuth, type Role } from '@buku/common';
import type { Request } from 'express';

/** Who/where a request came from — for audit logs and session records. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function requestContext(req: Request): RequestContext {
  return {
    // With `trust proxy` configured, req.ip is the real client IP, not Kong's.
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
    requestId: typeof req.id === 'string' ? req.id : null,
  };
}

/** The signed-in person, by their internal ID (database v2, DB-042), and what their token says. */
export interface Actor {
  id: bigint;
  role: Role;
  /** The session (its refresh-token family). */
  sessionId: bigint | undefined;
  mfa: boolean;
  /** Still on a business-issued temporary password: no business access yet (D-034). */
  mustChangePassword: boolean;
}

/** `requireAuth` with IDs: a token whose subject isn't a database v2 ID is refused. */
export function actorOf(req: Request): Actor {
  const auth = requireAuth(req);
  const id = idFromString(auth.userId);
  if (id === null) throw AppError.unauthorized('Invalid access token', ErrorCodes.TOKEN_INVALID);
  return {
    id,
    role: auth.role,
    sessionId: auth.sessionId === undefined ? undefined : (idFromString(auth.sessionId) ?? undefined),
    mfa: auth.mfa,
    mustChangePassword: auth.mustChangePassword,
  };
}
