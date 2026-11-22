import { GlobalExceptionFilter } from '@social-chat/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.use(cookieParser());

    app.enableCors({
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        credentials: true,
    });

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            transform: true,
            dismissDefaultMessages: false,
            validationError: {
                target: true,
            },
        }),
    );

    app.useGlobalFilters(new GlobalExceptionFilter(app.get(ClsService)));

    const config = new DocumentBuilder()
        .setTitle('Social Chat - AI Service')
        .setDescription('AI assistant API documentation')
        .setVersion('0.0.1')
        .addBearerAuth()
        .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/documentation', app, document);

    const port = process.env.APP_PORT || 3008;
    await app.listen(port);
    console.log(`AI service is running on: ${await app.getUrl()}`);
}

bootstrap();
