import type { Request, RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
  type RateLimiterAbstract,
} from 'rate-limiter-flexible';
import { AppError } from '../errors.js';

/**
 * Per-key rate limiting backed by Valkey, so limits hold across all replicas
 * of a service (an in-memory limiter would multiply the limit by replica count).
 *
 * The gateway (Kong) applies coarse per-IP limits; services apply precise,
 * business-aware ones (per user, per phone number, per business).
 */
export interface RateLimitOptions {
  /** Namespaces the counters, e.g. "rl:auth:login". */
  keyPrefix: string;
  /** Allowed requests per window. */
  points: number;
  /** Window length in seconds. */
  durationSeconds: number;
  /** Optional lockout after the limit is hit, in seconds. */
  blockSeconds?: number;
  /** Derive the bucket key; defaults to the authenticated user, else client IP. */
  key?: (req: Request) => string;
  /** Valkey client; omit to use an in-memory limiter (tests / single-process tools only). */
  redis?: Redis;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiterAbstract {
  const common = {
    keyPrefix: options.keyPrefix,
    points: options.points,
    duration: options.durationSeconds,
    blockDuration: options.blockSeconds ?? 0,
  };
  if (!options.redis) return new RateLimiterMemory(common);
  return new RateLimiterRedis({
    ...common,
    storeClient: options.redis,
    // If Valkey is unreachable, fall back to a per-process limiter rather
    // than failing open (no limit at all) or failing closed (outage).
    insuranceLimiter: new RateLimiterMemory(common),
  });
}

const defaultKey = (req: Request): string => req.auth?.userId ?? req.ip ?? 'unknown';

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const limiter = createRateLimiter(options);
  const keyOf = options.key ?? defaultKey;
  return async (req, res, next) => {
    try {
      const result = await limiter.consume(keyOf(req));
      res.setHeader('RateLimit-Limit', String(options.points));
      res.setHeader('RateLimit-Remaining', String(result.remainingPoints));
      res.setHeader('RateLimit-Reset', String(Math.ceil(result.msBeforeNext / 1000)));
      next();
    } catch (err) {
      if (err instanceof RateLimiterRes)
        throw AppError.rateLimited(Math.max(1, Math.ceil(err.msBeforeNext / 1000)));
      throw err;
    }
  };
}
