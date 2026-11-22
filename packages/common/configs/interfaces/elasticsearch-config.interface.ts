export const OPENSEARCH_CONFIG = 'OPENSEARCH_CONFIG';

export interface IOpenSearchConfig {
    node: string;
    auth?: {
        username: string;
        password: string;
    };
    tls?: {
        rejectUnauthorized: boolean;
        ca: string;
    };
}
