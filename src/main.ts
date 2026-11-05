import 'reflect-metadata';
import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger, Module, ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { ReportsModule } from './reports/reports.module';
import { UsersModule } from './users/users.module';
import { randomUUID } from 'node:crypto';
import { NextFunction, Response } from 'express';
import helmet from 'helmet';
import { audit } from './auth/audit';
import { ApiRequest } from './auth/auth.controller';
import { AuthModule } from './auth/auth.module';
import { Database, DatabaseModule } from './db';

@Module({
  imports: [DatabaseModule, AuthModule, ReportsModule, UsersModule, ScheduleModule.forRoot(), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }])],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class AppModule {}

@Catch()
class ApiErrorFilter implements ExceptionFilter {
  constructor(private readonly db: Database) {}

  async catch(error: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<ApiRequest>();
    const response = host.switchToHttp().getResponse<Response>();
    let status = error instanceof HttpException ? error.getStatus() : 500;
    const body = error instanceof HttpException ? error.getResponse() : undefined;
    const explicit = body && typeof body === 'object' && 'code' in body
      ? body as { code: string; message: string }
      : undefined;
    const defaults: Record<number, { code: string; message: string }> = {
      400: { code: 'INVALID_INPUT', message: 'Request validation failed' },
      404: { code: 'NOT_FOUND', message: 'Resource not found' },
      413: { code: 'PHOTO_TOO_LARGE', message: 'Photo exceeds the size limit' },
      429: { code: 'RATE_LIMITED', message: 'Too many requests' },
      500: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' },
      503: { code: 'AUDIT_UNAVAILABLE', message: 'Audit unavailable' },
    };
    let payload = explicit ?? defaults[status] ?? { code: 'REQUEST_FAILED', message: 'Request failed' };
    if (status === 500) Logger.error('Unexpected API error', 'HTTP');
    if (request.audit && payload.code !== 'AUDIT_UNAVAILABLE') {
      try {
        await audit(this.db.pool, request.audit, 'HTTP_FAILURE', status, request.user, payload.code);
      } catch {
        status = 503;
        payload = defaults[503];
      }
    }
    response.status(status).json(payload);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.use(helmet());
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean) });
  app.use('/api/v1', (request: ApiRequest, response: Response, next: NextFunction) => {
    const fixed = /^\/(auth\/(register|login|verify-email|resend-verification|refresh|logout|me)|reports|users|dashboard\/stats)$/;
    const resource = /^\/(reports|users)\/[^/]+(\/(photo|status))?$/;
    const match = resource.exec(request.path);
    const template = fixed.test(request.path) ? request.path : match ? `/${match[1]}/:id${match[2] ?? ''}` : '/*';
    const route = '/api/v1' + template;
    request.audit = { requestId: randomUUID(), method: request.method, route, started: Date.now() };
    response.setHeader('X-Request-Id', request.audit.requestId);
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  const db = app.get(Database);
  await db.pool.query('SELECT email_verified_at FROM users LIMIT 0');
  app.useGlobalFilters(new ApiErrorFilter(db));
  const config = new DocumentBuilder()
    .setTitle('Smart Waste Management API')
    .setDescription('Reports, dashboard, users and authentication. Verify your email before signing in. Access JWT: 15 minutes. Rotating refresh JWT: 7 days.')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config), { jsonDocumentUrl: 'api/docs/openapi.json' });
  await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
}

void bootstrap().catch(() => {
  Logger.error('Startup failed. Check configuration and database migrations.', 'Bootstrap');
  process.exit(1);
});
