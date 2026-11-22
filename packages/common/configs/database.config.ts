import { IDatabaseConfig } from './interfaces/database-config.interface';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const rootPath = resolve(__dirname, '..', '..', '..');

const getSslConfig = (): IDatabaseConfig['ssl'] => {
    if (process.env.DB_SSL !== 'true') {
        return false;
    }

    const caPath = process.env.DB_SSL_CA_PATH;
    if (!caPath) {
        throw new Error('DB_SSL_CA_PATH is required when DB_SSL=true');
    }

    return {
        rejectUnauthorized: true,
        ca: readFileSync(resolve(rootPath, caPath), 'utf8'),
    };
};

export const getDatabaseConfig = (): IDatabaseConfig => ({
    host: process.env.DB_HOST || 'localhost',
    port: Number.parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'social-chat-local',
    synchronize: Boolean(process.env.DB_SYNCHRONIZE === 'true'),
    ssl: getSslConfig(),
});
