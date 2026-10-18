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

/** The signed-in person by internal ID (shared by every service on database v2). */
export { requireActor as actorOf, type Actor } from '@buku/common';
