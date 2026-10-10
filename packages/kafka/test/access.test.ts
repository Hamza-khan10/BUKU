import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOPIC_SPECS, TOPICS, type Topic } from '../src/topics.js';

const root = new URL('../../../', import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** infrastructure/kafka/access.conf: what each service may publish and read (D-092). */
function plan() {
  const services = new Map<string, { publishes: string[]; consumes: string[] }>();
  for (const raw of read('infrastructure/kafka/access.conf').split('\n')) {
    const [service, what, ...topics] = raw.replace(/#.*/, '').trim().split(/\s+/);
    if (!service) continue;
    if (what !== 'publishes' && what !== 'consumes') throw new Error(`${service}: "${what}"`);
    const entry = services.get(service) ?? { publishes: [], consumes: [] };
    entry[what].push(...topics);
    services.set(service, entry);
  }
  return services;
}

const BY_CONST = new Map<string, Topic>(Object.entries(TOPICS));
const topicsIn = (source: string) =>
  [...source.matchAll(/TOPICS\.([A-Z_]+)/g)].map((m) => BY_CONST.get(m[1]!) ?? `TOPICS.${m[1]!}`);

function sourceOf(dir: string): string {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith('.ts'))
    .map((f) => readFileSync(join(f.parentPath, f.name), 'utf8'))
    .join('\n');
}

/** What a service's code uses: the topics it subscribes to, and every other topic it names. */
function used(service: string) {
  const handlers = `services/${service}/src/events/handlers.ts`;
  const list = existsSync(join(root, handlers))
    ? /CONSUMED_TOPICS: Topic\[\] = \[([\s\S]*?)\]/.exec(read(handlers))?.[1]
    : undefined;
  const consumes = new Set(topicsIn(list ?? ''));
  const named = new Set(topicsIn(sourceOf(`services/${service}/src`)));
  return { consumes, publishes: new Set([...named].filter((t) => !consumes.has(t))) };
}

const kafkaServices = readdirSync(join(root, 'services')).filter((s) =>
  read(`services/${s}/src/index.ts`).includes('kafkaConnectionFromEnv'),
);
const sorted = (xs: Iterable<string>) => [...xs].sort();

describe('who may publish and read which Kafka topics (D-092)', () => {
  const services = plan();

  it('names only topics in the registry', () => {
    const all = [...services.values()].flatMap((s) => [...s.publishes, ...s.consumes]);
    expect(all.filter((t) => !Object.hasOwn(TOPIC_SPECS, t))).toEqual([]);
  });

  it('every service that uses Kafka is in it, and nothing else', () => {
    expect(sorted(services.keys())).toEqual(sorted(kafkaServices));
  });

  it('gives each service exactly the topics its code uses: what it subscribes to, and what it publishes', () => {
    for (const s of kafkaServices) {
      const want = used(s);
      const got = services.get(s)!;
      expect(sorted(got.consumes), `${s} consumes`).toEqual(sorted(want.consumes));
      expect(sorted(got.publishes), `${s} publishes`).toEqual(sorted(want.publishes));
    }
  });

  it('each kind of event has one publisher', () => {
    const publishers = new Map<string, string[]>();
    for (const [s, { publishes }] of services)
      for (const t of publishes) publishers.set(t, [...(publishers.get(t) ?? []), s]);
    expect([...publishers].filter(([, who]) => who.length > 1)).toEqual([]);
  });

  it('every service signs in as its own user, with its own password', () => {
    const compose = read('docker-compose.dev.yml');
    for (const s of services.keys()) {
      const password = `\${KAFKA_PASSWORD_${s.toUpperCase()}:?run pnpm bootstrap}`;
      expect(compose, s).toContain(`KAFKA_SASL_USERNAME: buku-${s}\n      KAFKA_SASL_PASSWORD: ${password}`);
      expect(compose, `kafka-access sets ${s}'s password`).toContain(
        `KAFKA_PASSWORD_${s.toUpperCase()}: ${password}`,
      );
      expect(read('scripts/setup-dev.sh'), `setup generates ${s}'s password`).toMatch(
        new RegExp(`set_if_empty KAFKA_PASSWORD_${s.toUpperCase()}\\s`),
      );
    }
  });
});
