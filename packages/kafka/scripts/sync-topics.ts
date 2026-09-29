/**
 * Create / verify every Kafka topic from the registry in src/topics.ts.
 *
 *   pnpm kafka:topics            create missing topics, grow partition counts
 *   pnpm kafka:topics --check    verify only; exit 1 if anything is off
 *
 * Idempotent: safe to run on every deploy. Never deletes topics and never
 * shrinks partitions (Kafka cannot).
 *
 * Env: KAFKA_BROKERS, KAFKA_REPLICATION_FACTOR (dev 1, prod 3),
 *      KAFKA_MIN_INSYNC_REPLICAS (dev 1, prod 2), optional SASL/SSL vars.
 */
// CommonJS package: only some named exports are statically detectable from
// ESM, so the low-level AdminClient is read off the default export.
import kafkaLib from '@confluentinc/kafka-javascript';
import { createKafka, kafkaConnectionFromEnv } from '../src/client.js';
import { ALL_TOPICS, TOPIC_SPECS } from '../src/topics.js';

const checkOnly = process.argv.includes('--check');
const replicationFactor = Number(process.env.KAFKA_REPLICATION_FACTOR ?? 1);
const minInsyncReplicas = Number(process.env.KAFKA_MIN_INSYNC_REPLICAS ?? 1);

const connection = kafkaConnectionFromEnv('buku-topic-sync');
const admin = createKafka(connection).admin();

async function connectWithRetry(attempts = 30): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await admin.connect();
      await admin.listTopics({ timeout: 5_000 });
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`  waiting for Kafka (${i}/${attempts})...`);
      await admin.disconnect().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

/** The KafkaJS-compatible admin has no createPartitions; use the librdkafka admin client for it. */
function growPartitions(topic: string, total: number): Promise<void> {
  const client = kafkaLib.AdminClient.create({
    'bootstrap.servers': connection.brokers.join(','),
    'client.id': 'buku-topic-sync',
    ...(connection.ssl ? { 'security.protocol': connection.sasl ? 'sasl_ssl' : 'ssl' } : {}),
    ...(connection.sasl
      ? {
          'security.protocol': connection.ssl ? 'sasl_ssl' : 'sasl_plaintext',
          'sasl.mechanisms': connection.sasl.mechanism.toUpperCase(),
          'sasl.username': connection.sasl.username,
          'sasl.password': connection.sasl.password,
        }
      : {}),
  });
  return new Promise((resolve, reject) => {
    client.createPartitions(topic, total, 15_000, (err) => {
      client.disconnect();
      if (err) reject(new Error(`createPartitions(${topic}) failed: ${err.message}`));
      else resolve();
    });
  });
}

async function main(): Promise<void> {
  console.log(`Kafka topic sync (${checkOnly ? 'check only' : 'apply'}) → ${connection.brokers.join(',')}`);
  await connectWithRetry();

  const existing = new Set(await admin.listTopics());
  const missing = ALL_TOPICS.filter((t) => !existing.has(t));
  const problems: string[] = [];

  if (missing.length) {
    if (checkOnly) {
      problems.push(...missing.map((t) => `missing topic ${t}`));
    } else {
      await admin.createTopics({
        timeout: 30_000,
        topics: missing.map((topic) => ({
          topic,
          numPartitions: TOPIC_SPECS[topic].partitions,
          replicationFactor,
          configEntries: [
            { name: 'retention.ms', value: String(TOPIC_SPECS[topic].retentionMs) },
            { name: 'min.insync.replicas', value: String(minInsyncReplicas) },
            { name: 'cleanup.policy', value: 'delete' },
          ],
        })),
      });
      for (const t of missing) console.log(`  + created ${t} (${TOPIC_SPECS[t].partitions} partitions)`);
    }
  }

  const present = ALL_TOPICS.filter((t) => existing.has(t));
  if (present.length) {
    const metadata = await admin.fetchTopicMetadata({ topics: present });
    for (const { name, partitions } of metadata) {
      const wanted = TOPIC_SPECS[name as keyof typeof TOPIC_SPECS].partitions;
      if (partitions.length < wanted) {
        if (checkOnly) problems.push(`${name}: ${partitions.length} partitions, expected ${wanted}`);
        else {
          await growPartitions(name, wanted);
          console.log(`  ↑ ${name}: partitions ${partitions.length} → ${wanted}`);
        }
      } else if (partitions.length > wanted) {
        console.warn(
          `  ! ${name}: has ${partitions.length} partitions (registry says ${wanted}); update the registry`,
        );
      }
    }
  }

  await admin.disconnect();

  if (problems.length) {
    for (const p of problems) console.error(`  ✘ ${p}`);
    process.exit(1);
  }
  console.log(`✔ ${ALL_TOPICS.length} topics in place`);
}

main().catch(async (err: unknown) => {
  console.error('topic sync failed:', err);
  await admin.disconnect().catch(() => undefined);
  process.exit(1);
});
