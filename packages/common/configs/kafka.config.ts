import { IKafkaAppConfig } from './interfaces/kafka-config.interface';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const rootPath = resolve(__dirname, '..', '..', '..');

const getKafkaSecurityConfig = (): Pick<IKafkaAppConfig, 'ssl' | 'sasl'> => {
  if (process.env.KAFKA_SSL !== 'true') {
    return {};
  }

  const caPath = process.env.KAFKA_SSL_CA_PATH;
  const username = process.env.KAFKA_SASL_USERNAME;
  const password = process.env.KAFKA_SASL_PASSWORD;

  if (!caPath || !username || !password) {
    throw new Error(
      'KAFKA_SSL_CA_PATH, KAFKA_SASL_USERNAME, and KAFKA_SASL_PASSWORD are required when KAFKA_SSL=true',
    );
  }

  return {
    ssl: {
      rejectUnauthorized: true,
      ca: [readFileSync(resolve(rootPath, caPath), 'utf8')],
    },
    sasl: {
      mechanism: 'plain',
      username,
      password,
    },
  };
};

export const getKafkaConfig = (): IKafkaAppConfig => ({
  brokers: (process.env.KAFKA_BROKERS || 'localhost:29092').split(','),
  clientId: process.env.KAFKA_CLIENT_ID || 'social-chat',
  ...getKafkaSecurityConfig(),
});
