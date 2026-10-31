import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * TLS for every connection to Postgres (docs/DATABASE.md DB-020): the server accepts network
 * connections only over TLS 1.3, and every client checks the server's certificate and that it is
 * for the host it dialled (`verify-full`). Configured with libpq's own settings, so psql, Prisma's
 * CLI and our services read the same two: PGSSLMODE=verify-full and PGSSLROOTCERT (the authority
 * that signs the servers' certificates). PGSSLMODE=disable turns it off (nothing accepts that but a
 * server without TLS). With neither set, the driver's default applies: no TLS, which a BUKU server
 * refuses — a missing setting fails loudly instead of connecting in the clear.
 */

const authorities = new Map<string, string>();

export type TlsOptions = false | { ca: string; rejectUnauthorized: true };

export function tlsOptions(env: NodeJS.ProcessEnv = process.env): TlsOptions | undefined {
  const mode = env.PGSSLMODE;
  if (!mode) return undefined;
  if (mode === 'disable') return false;
  if (mode !== 'verify-full')
    throw new Error(`PGSSLMODE=${mode}: BUKU connects with verify-full (or disable), never without checking`);
  const path = env.PGSSLROOTCERT;
  if (!path) throw new Error('PGSSLMODE=verify-full needs PGSSLROOTCERT, the certificate authority to trust');
  let ca = authorities.get(path);
  if (ca === undefined) {
    ca = readFileSync(path, 'utf8');
    authorities.set(path, ca);
  }
  // Node checks the chain against this authority and the name against the host (checkServerIdentity).
  return { ca, rejectUnauthorized: true };
}

/**
 * The same rule for Prisma's CLI (migrations), whose engine takes TLS settings in the URL in its own
 * words: TLS required, and with `sslaccept=strict` the chain checked against `sslcert` (PGSSLROOTCERT,
 * as an absolute path) and the certificate's name against the host. Unchanged without PGSSLMODE.
 */
export function cliUrl(url: string, env: NodeJS.ProcessEnv = process.env): string {
  const tls = tlsOptions(env);
  if (tls === undefined) return url;
  const parsed = new URL(url);
  if (tls === false) {
    parsed.searchParams.set('sslmode', 'disable');
  } else {
    parsed.searchParams.set('sslmode', 'require');
    parsed.searchParams.set('sslaccept', 'strict');
    parsed.searchParams.set('sslcert', resolve(env.PGSSLROOTCERT as string));
  }
  return parsed.toString();
}
