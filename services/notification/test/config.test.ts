import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Env } from '../src/config.js';

/** Problems with this service's own settings (the shared ones are tested in @buku/common). */
const problems = (env: Record<string, string>) =>
  (Env.safeParse(env).error?.issues ?? [])
    .map((i) => String(i.path[0]))
    .filter((k) => /^(SMTP|WHATSAPP|EXPO|PUSH|WEB|PUBLIC)_/.test(k));

const base = {
  NODE_ENV: 'development',
  SERVICE_NAME: 'notification-service',
  PORT: '3004',
  JWT_ISSUER: 'https://auth.test',
  JWT_AUDIENCE: 'buku-api',
  JWT_PUBLIC_KEY: 'x',
  KAFKA_BROKERS: 'kafka:9092',
  DATABASE_URL: 'postgresql://u:p@db:5432/buku',
  REDIS_URL: 'redis://valkey:6379/0',
  SMTP_HOST: 'mailpit',
  PII_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  PII_ENCRYPTION_ACTIVE_KEY_ID: 'k1',
  PII_BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
};

describe('notification-service configuration', () => {
  it('blank optional values from Docker Compose count as not set', () => {
    expect(
      problems({
        ...base,
        WHATSAPP_BUSINESS_NUMBER: '',
        WHATSAPP_APP_SECRET: '',
        WHATSAPP_VERIFY_TOKEN: '',
        SMTP_USER: '',
        EXPO_ACCESS_TOKEN: '',
      }),
    ).toEqual([]);
  });

  it('the Meta sender needs all of its settings; production needs encrypted email', () => {
    expect(
      Env.safeParse({ ...base, WHATSAPP_PROVIDER: 'meta', WHATSAPP_BUSINESS_NUMBER: '+923001234567' })
        .success,
    ).toBe(false);
    expect(Env.safeParse({ ...base, WHATSAPP_BUSINESS_NUMBER: '0300 1234567' }).success).toBe(false);
    expect(Env.safeParse({ ...base, NODE_ENV: 'production' }).success).toBe(false);
  });
});
