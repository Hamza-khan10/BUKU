import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Every service declares ONE Zod schema for its environment and loads it once
 * at startup with `loadConfig`. If anything is missing or malformed the process
 * refuses to start and prints which variables are wrong — never their values,
 * since they are usually secrets.
 */

export const NodeEnv = z.enum(['development', 'test', 'production']);
export type NodeEnv = z.infer<typeof NodeEnv>;

export const LogLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

/** "true"/"false"/"1"/"0"/"yes"/"no" → boolean. */
export const envBool = z.stringbool({
  truthy: ['true', '1', 'yes', 'on'],
  falsy: ['false', '0', 'no', 'off', ''],
});

/** A secret that must be present and non-trivial. */
export const envSecret = (minLength = 16) =>
  z.string().min(minLength, `must be at least ${minLength} characters`);

/** Base64-encoded PEM (single-line, safe for .env files) → PEM string. */
export const envPem = (kind: 'PRIVATE KEY' | 'PUBLIC KEY') =>
  z
    .string()
    .min(1)
    .transform((value, ctx) => {
      const pem = value.includes('-----BEGIN') ? value : Buffer.from(value, 'base64').toString('utf8');
      if (!pem.includes(`-----BEGIN ${kind}-----`)) {
        ctx.addIssue({ code: 'custom', message: `must be a base64-encoded PEM "${kind}"` });
        return z.NEVER;
      }
      return pem;
    });

/** Settings every HTTP service shares. Extend it with `.extend({...})`. */
export const baseServiceEnv = z.object({
  NODE_ENV: NodeEnv.default('development'),
  SERVICE_NAME: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535),
  LOG_LEVEL: LogLevel.default('info'),
  LOG_PRETTY: envBool.default(false),
  /**
   * Number of reverse proxies in front of the service (Kong = 1). Express uses
   * this to derive the real client IP from X-Forwarded-For; getting it wrong
   * lets clients spoof their IP and bypass per-IP rate limits.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /** Delay between failing readiness and closing the server, so load balancers stop routing first. */
  SHUTDOWN_DELAY_MS: z.coerce.number().int().min(0).max(30_000).default(0),
  HTTP_BODY_LIMIT: z.string().default('100kb'),
});
export type BaseServiceEnv = z.infer<typeof baseServiceEnv>;

/** Values that must never reach production. Checked case-insensitively as substrings. */
const DEV_PLACEHOLDER_MARKERS = ['dev_mock', 'changeme', 'change_me', 'localdev', 'dev_password', 'example'];

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

export interface LoadConfigOptions {
  /** Variables that are allowed to contain placeholder markers even in production (e.g. public URLs). */
  placeholderAllowlist?: string[];
}

/**
 * Parse and validate `env` against `schema`.
 * In production, additionally rejects secrets that still hold development placeholders.
 */
export function loadConfig<S extends z.ZodType<Record<string, unknown>>>(
  schema: S,
  env: NodeJS.ProcessEnv = process.env,
  options: LoadConfigOptions = {},
): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigError(problems);
  }

  if (env.NODE_ENV === 'production') {
    const allow = new Set(options.placeholderAllowlist ?? []);
    const problems: string[] = [];
    for (const [key, value] of Object.entries(result.data)) {
      if (allow.has(key) || typeof value !== 'string') continue;
      const lower = value.toLowerCase();
      if (DEV_PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker))) {
        problems.push(`${key}: contains a development placeholder value`);
      }
    }
    if (problems.length) throw new ConfigError(problems);
  }

  return result.data;
}

// ── Reusable env fragments. Compose a service schema from these: ────────────
//    const Env = baseServiceEnv.extend({ ...databaseEnv.shape, ...redisEnv.shape })

export const databaseEnv = z.object({
  /** Runtime connection as the data-only `buku_app` role. */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),
});

export const redisEnv = z.object({
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
});

export const kafkaEnv = z.object({
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_SSL: envBool.default(false),
  KAFKA_SASL_MECHANISM: z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).optional(),
  KAFKA_SASL_USERNAME: z.string().optional(),
  KAFKA_SASL_PASSWORD: z.string().optional(),
});

/** Every service that accepts user requests verifies access tokens. */
export const jwtVerifyEnv = z.object({
  JWT_PUBLIC_KEY: envPem('PUBLIC KEY'),
  JWT_KEY_ID: z.string().min(1).max(64),
  /** Optional previous key, accepted during a key rotation window. */
  JWT_PREVIOUS_PUBLIC_KEY: envPem('PUBLIC KEY').optional(),
  JWT_PREVIOUS_KEY_ID: z.string().min(1).max(64).optional(),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
});
export type JwtVerifyEnv = z.infer<typeof jwtVerifyEnv>;
