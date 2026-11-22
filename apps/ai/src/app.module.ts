import { randomUUID } from 'crypto';
import { resolve } from 'path';

import {
    IMongoConfig,
    MONGO_CONFIG,
    SOCIAL_CHAT_KEYCLOAK_CONFIG,
    REQ_ID_HEADER,
    configs,
} from '@social-chat/common';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { ClsModule } from 'nestjs-cls';

import { AiModule } from './ai.module';
import { LibAuthModule, RefreshTokenMiddleware } from '@social-chat/shared-libs';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            cache: true,
            envFilePath: [
                resolve(__dirname, '..', '..', '..', 'config', '.env.ai'),
                resolve(__dirname, '..', '..', '..', 'config', '.env.common'),
            ],
            load: [configs],
        }),
        ClsModule.forRoot({
            global: true,
            middleware: {
                mount: true,
                saveReq: true,
                generateId: true,
                idGenerator: (req: Request) => {
                    return req.headers[REQ_ID_HEADER] ?? (randomUUID() as any);
                },
            },
        }),
        EventEmitterModule.forRoot(),
        MongooseModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const mongoConfig = configService.get<IMongoConfig>(MONGO_CONFIG);
                return { uri: mongoConfig.uri };
            },
        }),
        PassportModule,
        AiModule,
        LibAuthModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const keycloakConfig = configService.get(SOCIAL_CHAT_KEYCLOAK_CONFIG);
                return { config: keycloakConfig };
            },
        }),
    ],
    providers: [],
    exports: [AiModule],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(RefreshTokenMiddleware).forRoutes('*');
    }
}
