import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** infrastructure/valkey/access.acl: each user's keys and channels (D-092). */
const plan = new Map(
  read('infrastructure/valkey/access.acl')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rules] = line.split(/\s+/);
      return [name!, rules] as const;
    }),
);

const glob = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`);
/** Keys a user may write: ~pattern (read-only %R~ excluded). */
const writable = (rules: readonly string[]) =>
  rules.filter((r) => r.startsWith('~')).map((r) => glob(r.slice(1)));
const readable = (rules: readonly string[]) =>
  rules.filter((r) => r.startsWith('~') || r.startsWith('%R~')).map((r) => glob(r.replace(/^(%R)?~/, '')));

function sourceOf(dir: string): string {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith('.ts'))
    .map((f) => readFileSync(join(f.parentPath, f.name), 'utf8'))
    .join('\n');
}

/** The key prefixes a service's code names: rate-limit counters and keys passed to Valkey calls. */
function keysUsed(service: string): string[] {
  const src = sourceOf(`services/${service}/src`);
  const prefixes = [...src.matchAll(/keyPrefix: '([^']+)'/g)].map((m) => `${m[1]!}:x`);
  const literal =
    /\.(?:get|set|del|getdel|incr|expire|mget|exists)\(\s*[`'"]([a-z][a-z0-9_-]*:[a-z0-9_:-]*)/g;
  // Picture uploads waiting to be finished (packages/media), by purpose.
  const uploads = [...src.matchAll(/uploads\.(?:request|complete)\('([a-z_]+)'/g)].map(
    (m) => `media:upload:${m[1]!}:x`,
  );
  return [...prefixes, ...uploads, ...[...src.matchAll(literal)].map((m) => `${m[1]!}x`)];
}

const compose = read('docker-compose.dev.yml');
const valkeyServices = [...compose.matchAll(/REDIS_URL: redis:\/\/buku-([a-z]+):/g)].map((m) => m[1]!);

describe('what each Valkey user may touch (D-092)', () => {
  it('every service that uses Valkey signs in as its own user, with its own password', () => {
    expect(valkeyServices.length).toBeGreaterThan(0);
    expect(compose).not.toMatch(/REDIS_URL: redis:\/\/:/);
    for (const s of valkeyServices) {
      const S = s.toUpperCase();
      expect(plan.has(s), `${s} in access.acl`).toBe(true);
      expect(compose).toContain(
        `REDIS_URL: redis://buku-${s}:\${VALKEY_PASSWORD_${S}:?run pnpm bootstrap}@valkey:6379/0`,
      );
      expect(compose, `Valkey gets ${s}'s password`).toContain(
        `VALKEY_PASSWORD_${S}: \${VALKEY_PASSWORD_${S}:?run pnpm bootstrap}`,
      );
      expect(read('scripts/setup-dev.sh')).toMatch(new RegExp(`set_if_empty VALKEY_PASSWORD_${S}\\s`));
    }
  });

  it("covers every key each service's code uses, and only its own", () => {
    for (const s of valkeyServices) {
      const mine = writable(plan.get(s)!);
      const missing = keysUsed(s).filter((k) => !mine.some((p) => p.test(k)));
      expect(missing, `${s} uses keys outside its line`).toEqual([]);
    }
  });

  it('every service reads the sign-out list; only auth writes it', () => {
    for (const s of valkeyServices) {
      expect(
        readable(plan.get(s)!).some((p) => p.test('auth:rev:user:x')),
        `${s} reads it`,
      ).toBe(true);
      expect(
        writable(plan.get(s)!).some((p) => p.test('auth:rev:user:x')),
        `${s} writes it`,
      ).toBe(s === 'auth');
    }
  });

  it('no user may touch every key, every channel, or run commands beyond the shared set', () => {
    for (const [name, rules] of plan) {
      const extras = rules.filter((r) => r.startsWith('+') || r.startsWith('-'));
      expect(rules, name).not.toContain('~*');
      expect(rules, name).not.toContain('allkeys');
      expect(rules, name).not.toContain('allchannels');
      expect(rules, name).not.toContain('&*');
      // Only these may be added to the shared commands: the live queue's channel, Kong's database.
      expect(
        extras.filter((r) => !['+@pubsub', '+select'].includes(r)),
        name,
      ).toEqual([]);
    }
    expect(read('infrastructure/valkey/start.sh')).toContain("-@dangerous -select +info'");
  });

  it("only the queue's live channel is open, and only to the queue", () => {
    for (const [name, rules] of plan) {
      const channels = rules.filter((r) => r.startsWith('&'));
      expect(channels, name).toEqual(name === 'queue' ? ['&queue:changes'] : []);
    }
    expect(sourceOf('services/queue/src')).toContain("CHANGES_CHANNEL = 'queue:changes'");
  });
});
