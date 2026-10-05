import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Simulated time on the development stack, the way the acceptance tests do it
 * (scripts/acceptance/client.ts): a test can't wait for a visit to happen, so
 * a step moves it in the development database — as the app's own role, never
 * an admin. Unavailable (no stack, no .env) → null, and the test skips.
 */

function appPassword(): string | null {
  if (process.env.BUKU_APP_PASSWORD) return process.env.BUKU_APP_PASSWORD;
  try {
    const env = readFileSync(new URL('../../../.env', import.meta.url), 'utf8');
    return (
      /^BUKU_APP_PASSWORD=(.+)$/m
        .exec(env)?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, '') ?? null
    );
  } catch {
    return null;
  }
}

export function sql(statement: string): string | null {
  const password = appPassword();
  if (!password) return null;
  try {
    return execFileSync(
      'docker',
      [
        'exec',
        '-e',
        `PGPASSWORD=${password}`,
        'buku-postgres-1',
        'psql',
        '-h',
        'localhost',
        '-U',
        'buku_app',
        '-d',
        'buku',
        '-Atq',
        '-c',
        statement,
      ],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return null;
  }
}

export const canSimulateTime = () => sql('SELECT 1') === '1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The visit happened `days` ago and the business marked it completed (what
 * the front desk does after a visit). Tries a few days in case the person was
 * busy then.
 */
export function visitHappened(appointmentId: string, days = 5): boolean {
  if (!UUID.test(appointmentId)) throw new Error('not an appointment id');
  for (let d = days; d < days + 10; d++) {
    const done = sql(
      `UPDATE appointments SET status = 'completed', version = version + 1,
         start_at = start_at - interval '${d} days', end_at = end_at - interval '${d} days',
         blocked_until = blocked_until - interval '${d} days'
       WHERE id = '${appointmentId}' RETURNING id`,
    );
    if (done === appointmentId) return true;
  }
  return false;
}

/** Give an account a picture link, as a sign-in provider would. */
export function pictureFromProvider(userId: string, url: string): boolean {
  if (!UUID.test(userId)) throw new Error('not a user id');
  if (!/^https?:\/\/[\w.:-]+\/[\w./-]*$/.test(url)) throw new Error('not a plain picture link');
  return sql(`UPDATE users SET avatar_url = '${url}' WHERE id = '${userId}' RETURNING 1`) === '1';
}
