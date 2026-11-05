import {
  Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Injectable, Post,
  Req, UnauthorizedException, UseGuards, applyDecorators,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiOperation, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Database } from '../db';
import { AuditContext, audit } from './audit';
import { AuthService } from './auth.service';
import { EmailDto, ErrorDto, LoginDto, MessageDto, RefreshDto, RegisterDto, TokensDto, UserDto, VerifyEmailDto } from './dto';

export type ApiRequest = Request & { audit: AuditContext; user?: UserDto };

export function Document(operation: string, status: number, response: import('@nestjs/common').Type<unknown> | undefined,
  errors: Record<number, string> = {}) {
  return applyDecorators(
    ApiOperation({ summary: operation }),
    ApiResponse({ status, type: response }),
    ...Object.entries({
      429: 'Too many requests',
      500: 'Unexpected server error',
      503: 'Required backend dependency unavailable',
      ...errors,
    }).map(([code, description]) => ApiResponse({ status: Number(code), description, type: ErrorDto })),
  );
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const token = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException({ code: 'MISSING_TOKEN', message: 'Bearer token required' });
    request.user = await this.auth.authenticate(token);
    return true;
  }
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly db: Database) {}

  @Post('register')
  @Document('Register and request an email verification code', 201, MessageDto, {
    400: 'Invalid registration data', 409: 'Email unavailable',
  })
  register(@Body() body: RegisterDto, @Req() request: ApiRequest) {
    return this.auth.register(body, request.audit);
  }

  @Post('verify-email')
  @HttpCode(200)
  @Document('Verify an email with a six-digit code valid for 10 minutes', 200, MessageDto, {
    400: 'Invalid code format', 401: 'Invalid, expired, consumed or attempt-limited code',
  })
  verify(@Body() body: VerifyEmailDto, @Req() request: ApiRequest) {
    return this.auth.verifyEmail(body.email, body.code, request.audit);
  }

  @Post('resend-verification')
  @HttpCode(202)
  @Document('Request a replacement code after a 60-second cooldown', 202, MessageDto, { 400: 'Invalid email' })
  resend(@Body() body: EmailDto, @Req() request: ApiRequest) {
    return this.auth.resend(body.email, request.audit);
  }

  @Post('login')
  @HttpCode(200)
  @Document('Sign in with a verified email and receive a token pair', 200, TokensDto, {
    400: 'Invalid input', 401: 'Invalid credentials or inactive account', 403: 'Email unverified',
  })
  login(@Body() body: LoginDto, @Req() request: ApiRequest) {
    return this.auth.login(body, request.audit);
  }

  @Post('refresh')
  @HttpCode(200)
  @Document('Exchange a refresh JWT once for a new token pair', 200, TokensDto, {
    400: 'Invalid input', 401: 'Invalid, expired or consumed session',
  })
  refresh(@Body() body: RefreshDto, @Req() request: ApiRequest) {
    return this.auth.refresh(body.refreshToken, request.audit);
  }

  @Post('logout')
  @HttpCode(204)
  @Document('Revoke a refresh session', 204, undefined, {
    400: 'Invalid input', 401: 'Invalid, expired or consumed session',
  })
  logout(@Body() body: RefreshDto, @Req() request: ApiRequest) {
    return this.auth.logout(body.refreshToken, request.audit);
  }

  @Get('me')
  @UseGuards(AccessGuard)
  @ApiBearerAuth()
  @Document('Read the current authenticated user', 200, UserDto, { 401: 'Missing or invalid access token' })
  async me(@Req() request: ApiRequest) {
    await audit(this.db.pool, request.audit, 'AUTH_ME', 200, request.user);
    return request.user;
  }
}
