import type { Request } from 'express';

/** Who/where a request came from — for audit logs. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function requestContext(req: Request): RequestContext {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
    requestId: typeof req.id === 'string' ? req.id : null,
  };
}

export const auditCtx = (ctx: RequestContext) => ({
  ipAddress: ctx.ip,
  userAgent: ctx.userAgent,
  requestId: ctx.requestId,
});
