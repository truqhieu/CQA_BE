import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // ─── Global Prefix ───────────────────────────────────────────────────────────
  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  app.setGlobalPrefix(apiPrefix);

  // ─── CORS ─────────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // ─── Global Validation Pipe ───────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // Strip unknown properties
      forbidNonWhitelisted: true, // Throw error on unknown properties
      transform: true,           // Auto-transform payload to DTO types
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ─── Global Exception Filter ──────────────────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());

  // ─── Start Server ─────────────────────────────────────────────────────────────
  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`🚀 Application running on: http://localhost:${port}/${apiPrefix}`);
  logger.log(`📋 Auth endpoints: http://localhost:${port}/${apiPrefix}/auth`);
}

bootstrap();
