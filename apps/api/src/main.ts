import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import cookieParser = require('cookie-parser');
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

// Sentry must be initialized before the NestJS app (captures bootstrap errors too)
Sentry.init({
  dsn: process.env['SENTRY_DSN'],
  environment: process.env['NODE_ENV'] ?? 'development',
  enabled: process.env['NODE_ENV'] === 'production',
  release: process.env['SENTRY_RELEASE'] ?? undefined,
  tracesSampleRate: parseFloat(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.2'),
  beforeSend(event) {
    // Scrub PII from breadcrumbs and request data
    if (event.request?.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
    }
    return event;
  },
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Use pino as the application logger
  app.useLogger(app.get(Logger));

  // Raise the JSON body limit so admins can upload base64 screenshots for
  // email communications (default is 100kb). Other routes send small payloads.
  app.useBodyParser('json', { limit: '6mb' });

  // Security headers
  app.use(helmet());

  // Cookie parser (required for httpOnly refresh token cookies)
  app.use(cookieParser());

  // Global prefix
  app.setGlobalPrefix('v1');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // CORS
  // Production locks to the single configured WEB_ORIGIN. In dev we also
  // accept the common Expo web hostnames (localhost / mac.local) so testing
  // works regardless of which one the browser or Remote Control loaded —
  // otherwise auth/providers and other calls get CORS-blocked and features
  // like the dev-login button silently disappear.
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  app.enableCors({
    origin:
      process.env.NODE_ENV === 'production'
        ? webOrigin
        : [...new Set([webOrigin, 'http://localhost:8081', 'http://mac.local:8081'])],
    credentials: true,
  });

  // Swagger (disabled in production)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('FS Suite API')
      .setDescription('FS Suite — Flight simulation planning platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port);
}

void bootstrap();
