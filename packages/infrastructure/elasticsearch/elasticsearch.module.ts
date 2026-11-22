import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';

import { OPENSEARCH_CONFIG, IOpenSearchConfig } from '@social-chat/common';

@Module({
    imports: [ConfigModule],
    providers: [
        {
            provide: Client,
            inject: [ConfigService],
            useFactory: (configService: ConfigService): Client => {
                const config = configService.get<IOpenSearchConfig>(OPENSEARCH_CONFIG);

                if (!config) {
                    throw new Error('OpenSearch configuration is unavailable');
                }

                return new Client({
                    node: config.node,
                    auth: config.auth,
                    ssl: config.tls,
                });
            },
        },
    ],
    exports: [Client],
})
@Global()
export class OpenSearchInfraModule {}
