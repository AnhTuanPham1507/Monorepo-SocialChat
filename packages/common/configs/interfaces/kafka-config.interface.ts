export const KAFKA_CONFIG = 'KAFKA_CONFIG';

export interface IKafkaAppConfig {
  brokers: string[];
  clientId: string;
  ssl?: {
    rejectUnauthorized: boolean;
    ca: string[];
  };
  sasl?: {
    mechanism: 'plain';
    username: string;
    password: string;
  };
}
