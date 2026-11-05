import { ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createTransport } from 'nodemailer';
import { PoolClient } from 'pg';
import { Database, required } from '../db';
import { audit, AuditContext } from './audit';
import { LoginDto, RegisterDto, UserDto } from './dto';

const derive = promisify(scrypt);
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const unavailable = () => new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials or session' });
const accessSeconds = 900;
const refreshSeconds = 7 * 86400;
const userColumns = 'id, email, name, role, is_active AS "isActive", created_at AS "createdAt"';
type Account = UserDto & { emailVerifiedAt: Date | null; passwordHash: string };

function publicUser({ id, name, email, role, isActive, createdAt }: UserDto): UserDto {
  return { id, name, email, role, isActive, createdAt };
}

@Injectable()
export class AuthService {
  private readonly accessSecret = required('JWT_ACCESS_SECRET');
  private readonly refreshSecret = required('JWT_REFRESH_SECRET');
  private readonly mailFrom = process.env.MAIL_FROM?.trim() || process.env.SMTP_GOOGLE_USER?.trim();
  private readonly mail = this.configureMail();

  private configureMail() {
    const user = process.env.SMTP_GOOGLE_USER?.trim();
    const pass = process.env.SMTP_GOOGLE_APP_PASSWORD?.replace(/\s/g, '');
    if (user && pass) {
      return createTransport({ service: 'gmail', connectionTimeout: 5000, socketTimeout: 10000,
        auth: { user, pass } });
    }
    const url = process.env.SMTP_URL?.trim();
    if (url) {
      const endpoint = URL.parse(url);
      if (!endpoint?.hostname || !['smtp:', 'smtps:'].includes(endpoint.protocol)) {
        throw new Error('SMTP_URL must start with smtp:// or smtps://. For Gmail, fill both SMTP_GOOGLE variables and leave SMTP_URL empty.');
      }
      return createTransport(url);
    }
    if (user || pass) throw new Error('Set both SMTP_GOOGLE_USER and SMTP_GOOGLE_APP_PASSWORD to use Gmail.');
    return undefined;
  }

  constructor(private readonly db: Database, private readonly jwt: JwtService) {
    if (this.accessSecret.length < 32 || this.refreshSecret.length < 32 || this.accessSecret === this.refreshSecret) {
      throw new Error('JWT secrets must be distinct and at least 32 characters');
    }
  }

  async register(input: RegisterDto, context: AuditContext) {
    const salt = randomBytes(16).toString('hex');
    const hash = (await derive(input.password, salt, 64) as Buffer).toString('hex');
    const code = await this.db.transaction(async client => {
      const result = await client.query<UserDto>(
        `INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3)
         ON CONFLICT (email) DO NOTHING RETURNING ${userColumns}`,
        [input.email, input.name, `${salt}:${hash}`],
      );
      const user = result.rows[0];
      if (!user) throw new ConflictException({ code: 'EMAIL_UNAVAILABLE', message: 'Email unavailable' });
      const token = await this.createVerification(client, user.id);
      await audit(client, context, 'AUTH_REGISTER', 201, user);
      return token;
    });
    if (code) await this.sendCode(input.email, code);
    return { message: 'Check your email for a verification code.' };
  }

  async resend(email: string, context: AuditContext) {
    const code = await this.db.transaction(async client => {
      const result = await client.query<UserDto>(
        `SELECT ${userColumns} FROM users WHERE email=$1 AND email_verified_at IS NULL
         AND deleted_at IS NULL AND is_active FOR UPDATE`, [email],
      );
      const token = result.rows[0] ? await this.createVerification(client, result.rows[0].id) : undefined;
      await audit(client, context, 'AUTH_RESEND', 202);
      return token;
    });
    if (code) await this.sendCode(email, code);
    return { message: 'If eligible, check your email for a verification code.' };
  }

  private verificationDigest(id: string, code: string) {
    return createHmac('sha256', this.accessSecret).update(`email-verification:${id}:${code}`).digest('hex');
  }

  private async createVerification(client: PoolClient, id: string) {
    const code = randomInt(1_000_000).toString().padStart(6, '0');
    const result = await client.query(
      `INSERT INTO email_verifications(user_id,token_digest,expires_at)
       VALUES ($1,$2,now() + interval '10 minutes')
       ON CONFLICT (user_id) DO UPDATE SET token_digest=excluded.token_digest,
         expires_at=excluded.expires_at, failed_attempts=0
       WHERE email_verifications.expires_at <= now() + interval '9 minutes'`,
      [id, this.verificationDigest(id, code)],
    );
    return result.rowCount ? code : undefined;
  }

  private async sendCode(email: string, token: string) {
    try {
      if (!this.mail || !this.mailFrom) throw new Error('SMTP is not configured');
      const result = await this.mail.sendMail({
        from: this.mailFrom, to: email, subject: 'Verify your Smart Waste account',
        text: `Enter this code to verify your account. It expires in 10 minutes.\n\n${token}`,
      });
      if (result.rejected.length) throw new Error('Recipient rejected');
    } catch {
      Logger.warn('Verification email delivery failed', 'Auth');
    }
  }

  async verifyEmail(email: string, code: string, context: AuditContext) {
    const verified = await this.db.transaction(async client => {
      const result = await client.query<UserDto>(
        `SELECT ${userColumns} FROM users WHERE email=$1
         AND deleted_at IS NULL AND is_active AND email_verified_at IS NULL FOR UPDATE`, [email],
      );
      const user = result.rows[0];
      if (!user) return false;

      const consumed = await client.query(
        `DELETE FROM email_verifications WHERE user_id=$1 AND token_digest=$2
         AND expires_at > now() AND failed_attempts < 5`,
        [user.id, this.verificationDigest(user.id, code)],
      );
      if (!consumed.rowCount) {
        await client.query(
          `UPDATE email_verifications SET failed_attempts=failed_attempts+1
           WHERE user_id=$1 AND expires_at > now() AND failed_attempts < 5`, [user.id],
        );
        return false;
      }

      await client.query('UPDATE users SET email_verified_at=now(), updated_at=now() WHERE id=$1', [user.id]);
      await audit(client, context, 'AUTH_VERIFY', 200, user);
      return true;
    });
    if (!verified) throw new UnauthorizedException({ code: 'INVALID_VERIFICATION', message: 'Invalid or expired verification code' });
    return { message: 'Email verified. You can now sign in.' };
  }

  async login(input: LoginDto, context: AuditContext) {
    const result = await this.db.pool.query<Account>(
      `SELECT ${userColumns}, password_hash AS "passwordHash", email_verified_at AS "emailVerifiedAt"
       FROM users WHERE email=$1 AND deleted_at IS NULL`, [input.email],
    );
    const account = result.rows[0];
    const [salt, stored] = account?.passwordHash.split(':') ?? ['0'.repeat(32), '0'.repeat(128)];
    const hash = await derive(input.password, salt, 64) as Buffer;
    const expected = Buffer.from(stored ?? '', 'hex');
    if (!account || expected.length !== hash.length || !timingSafeEqual(hash, expected)) throw unavailable();
    if (!account.isActive) throw unavailable();
    if (!account.emailVerifiedAt) {
      throw new ForbiddenException({ code: 'EMAIL_UNVERIFIED', message: 'Verify your email before signing in' });
    }
    return this.db.transaction(async client => {
      const user = await this.activeUser(account.id, client);
      const tokens = await this.issue(client, user);
      await audit(client, context, 'AUTH_LOGIN', 200, user);
      return tokens;
    });
  }

  async refresh(token: string, context: AuditContext) {
    const id = await this.subject(token, 'refresh');
    return this.db.transaction(async client => {
      const user = await this.activeUser(id, client);
      const consumed = await client.query(
        'DELETE FROM refresh_sessions WHERE user_id=$1 AND token_digest=$2 AND expires_at > now()',
        [id, digest(token)],
      );
      if (!consumed.rowCount) throw unavailable();
      const tokens = await this.issue(client, user);
      await audit(client, context, 'AUTH_REFRESH', 200, user);
      return tokens;
    });
  }

  async logout(token: string, context: AuditContext) {
    const id = await this.subject(token, 'refresh');
    await this.db.transaction(async client => {
      const user = await this.activeUser(id, client);
      const revoked = await client.query('DELETE FROM refresh_sessions WHERE user_id=$1 AND token_digest=$2', [id, digest(token)]);
      if (!revoked.rowCount) throw unavailable();
      await audit(client, context, 'AUTH_LOGOUT', 204, user);
    });
  }

  async authenticate(token: string) {
    return this.activeUser(await this.subject(token, 'access'));
  }

  private async activeUser(id: string, client?: PoolClient) {
    const result = await (client ?? this.db.pool).query<UserDto>(
      `SELECT ${userColumns} FROM users WHERE id=$1 AND is_active AND deleted_at IS NULL
       AND email_verified_at IS NOT NULL ${client ? 'FOR UPDATE' : ''}`, [id],
    );
    if (!result.rows[0]) throw unavailable();
    return publicUser(result.rows[0]);
  }

  private async subject(token: string, kind: 'access' | 'refresh') {
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; kind: string }>(token, {
        secret: kind === 'access' ? this.accessSecret : this.refreshSecret,
        algorithms: ['HS256'], issuer: 'bilcode-api', audience: `bilcode-${kind}`,
      });
      if (claims.kind !== kind || typeof claims.sub !== 'string') throw unavailable();
      return claims.sub;
    } catch {
      throw unavailable();
    }
  }

  private async issue(client: PoolClient, user: UserDto) {
    const sign = (kind: 'access' | 'refresh', secret: string, expiresIn: number) =>
      this.jwt.signAsync({ kind }, { secret, expiresIn, algorithm: 'HS256', issuer: 'bilcode-api',
        audience: `bilcode-${kind}`, subject: user.id, jwtid: randomUUID() });
    const [accessToken, refreshToken] = await Promise.all([
      sign('access', this.accessSecret, accessSeconds), sign('refresh', this.refreshSecret, refreshSeconds),
    ]);
    await client.query(
      'INSERT INTO refresh_sessions(user_id,token_digest,expires_at) VALUES ($1,$2,now() + make_interval(secs => $3))',
      [user.id, digest(refreshToken), refreshSeconds],
    );
    return { accessToken, refreshToken, expiresIn: accessSeconds, user };
  }
}
