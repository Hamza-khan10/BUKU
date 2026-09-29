import { pino, stdSerializers, type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

/**
 * Paths whose values must never appear in logs. Covers credentials (GDPR and
 * security) and direct identifiers (GDPR). Pino redaction is path-based, so
 * as a rule: log IDs, never whole request bodies or user objects.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-paddle-signature"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.idToken',
  '*.otp',
  '*.secret',
  '*.apiKey',
  '*.privateKey',
  '*.email',
  '*.phone',
];

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  pretty?: boolean;
  /** Extra static fields added to every line (e.g. environment, version). */
  base?: Record<string, unknown>;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const config: LoggerOptions = {
    level: options.level ?? 'info',
    base: { service: options.service, ...options.base },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Emit `"level":"info"` instead of numeric levels: easier to query in Loki/Grafana.
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: { err: stdSerializers.errWithCause },
  };
  if (options.pretty) {
    config.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,service' },
    };
  }
  return pino(config);
}

/**
 * Process-wide default logger, configured from the environment at import time
 * so that shared packages (database, kafka) can log before a service has
 * finished loading its own config. Services use `logger.child({...})` for context.
 */
export const logger: Logger = createLogger({
  service: process.env.SERVICE_NAME ?? 'buku',
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  pretty: process.env.LOG_PRETTY === 'true',
  base: { env: process.env.NODE_ENV ?? 'development' },
});
