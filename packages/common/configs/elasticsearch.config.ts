import { IOpenSearchConfig } from './interfaces/elasticsearch-config.interface';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const rootPath = resolve(__dirname, '..', '..', '..');

export const getOpenSearchConfig = (): IOpenSearchConfig => {
    const node = process.env.OPENSEARCH_NODE;
    const username = process.env.OPENSEARCH_USERNAME;
    const password = process.env.OPENSEARCH_PASSWORD;
    const caPath = process.env.OPENSEARCH_SSL_CA_PATH;

    if (!node) {
        throw new Error('OPENSEARCH_NODE is required');
    }

    return {
        node,
        ...(username && password ? { auth: { username, password } } : {}),
        ...(caPath
            ? {
                  tls: {
                      rejectUnauthorized: true,
                      ca: readFileSync(resolve(rootPath, caPath), 'utf8'),
                  },
              }
            : {}),
    };
};
