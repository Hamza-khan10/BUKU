import { KafkaJS } from '@confluentinc/kafka-javascript';
import { logger } from '@buku/common';

/**
 * Kafka client configuration.
 *
 * Library: Confluent's official client (@confluentinc/kafka-javascript),
 * built on librdkafka — the same engine as the Java/Go/Python clients. It
 * exposes a KafkaJS-compatible API. We do NOT use `kafkajs` itself: it has
 * been unmaintained since 2023 and does not track Kafka 4.x.
 *
 * Security: SASL/SSL are optional so dev can run PLAINTEXT on a private
 * Docker network; production must set KAFKA_SASL_* and KAFKA_SSL=true.
 */
export interface KafkaConnectionOptions {
  brokers: string[];
  clientId: string;
  ssl?: boolean;
  sasl?: { mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512'; username: string; password: string };
}

export function kafkaConnectionFromEnv(
  clientId: string,
  env: NodeJS.ProcessEnv = process.env,
): KafkaConnectionOptions {
  const brokers = (env.KAFKA_BROKERS ?? 'localhost:9092')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
  const options: KafkaConnectionOptions = { brokers, clientId, ssl: env.KAFKA_SSL === 'true' };
  if (env.KAFKA_SASL_USERNAME && env.KAFKA_SASL_PASSWORD) {
    options.sasl = {
      mechanism: (env.KAFKA_SASL_MECHANISM as 'scram-sha-512' | undefined) ?? 'scram-sha-512',
      username: env.KAFKA_SASL_USERNAME,
      password: env.KAFKA_SASL_PASSWORD,
    };
  }
  return options;
}

const kafkaLog = logger.child({ module: 'kafka' });

/** Routes librdkafka's internal logging through our structured logger. */
const bridgeLogger: KafkaJS.Logger = {
  info: (message, extra) => kafkaLog.info(extra ?? {}, message),
  warn: (message, extra) => kafkaLog.warn(extra ?? {}, message),
  error: (message, extra) => kafkaLog.error(extra ?? {}, message),
  debug: (message, extra) => kafkaLog.debug(extra ?? {}, message),
  namespace: () => bridgeLogger,
  setLogLevel: () => undefined,
};

export function createKafka(options: KafkaConnectionOptions): KafkaJS.Kafka {
  return new KafkaJS.Kafka({
    kafkaJS: {
      brokers: options.brokers,
      clientId: options.clientId,
      ssl: options.ssl ?? false,
      ...(options.sasl ? { sasl: options.sasl } : {}),
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
      retry: { initialRetryTime: 300, retries: 5, maxRetryTime: 30_000 },
      logger: bridgeLogger,
      logLevel: KafkaJS.logLevel.WARN,
    },
  });
}
