import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';
import { envs } from 'libs/config/src/envs';
import type { JwtPayload } from '../../shared/auth/types/authenticated-user.type';

@Injectable()
export class AuthCryptoService {
  private readonly iterations = 210000;
  private readonly keyLength = 32;
  private readonly digest = 'sha256';

  hashPassword(password: string): string {
    const salt = randomBytes(16).toString('base64url');
    const hash = pbkdf2Sync(
      password,
      salt,
      this.iterations,
      this.keyLength,
      this.digest,
    ).toString('base64url');
    return `pbkdf2$${this.iterations}$${salt}$${hash}`;
  }

  verifyPassword(password: string, storedHash: string): boolean {
    const [scheme, iterationsValue, salt, expectedHash] = storedHash.split('$');
    if (scheme !== 'pbkdf2' || !iterationsValue || !salt || !expectedHash) {
      return false;
    }

    const iterations = Number(iterationsValue);
    if (!Number.isInteger(iterations) || iterations <= 0) {
      return false;
    }

    const actual = pbkdf2Sync(
      password,
      salt,
      iterations,
      this.keyLength,
      this.digest,
    );
    const expected = Buffer.from(expectedHash, 'base64url');

    if (actual.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(actual, expected);
  }

  signJwt(payload: JwtPayload): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const body = {
      ...payload,
      iat: now,
      exp: now + this.parseExpiresIn(envs.JWT_EXPIRES_IN),
    };

    const encodedHeader = this.encodeJson(header);
    const encodedBody = this.encodeJson(body);
    const signature = this.sign(`${encodedHeader}.${encodedBody}`);

    return `${encodedHeader}.${encodedBody}.${signature}`;
  }

  verifyJwt(token: string): JwtPayload {
    const [encodedHeader, encodedBody, signature] = token.split('.');
    if (!encodedHeader || !encodedBody || !signature) {
      throw new UnauthorizedException('Token inválido');
    }

    const expectedSignature = this.sign(`${encodedHeader}.${encodedBody}`);
    if (!this.safeCompare(signature, expectedSignature)) {
      throw new UnauthorizedException('Token inválido');
    }

    const payload = JSON.parse(
      Buffer.from(encodedBody, 'base64url').toString('utf8'),
    ) as JwtPayload;
    if (
      !payload.sub ||
      !payload.email ||
      !payload.role ||
      !payload.permission
    ) {
      throw new UnauthorizedException('Token inválido');
    }

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expirado');
    }

    return payload;
  }

  private encodeJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private sign(value: string): string {
    return createHmac('sha256', this.getSecret())
      .update(value)
      .digest('base64url');
  }

  private safeCompare(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);

    if (left.length !== right.length) {
      return false;
    }

    return timingSafeEqual(left, right);
  }

  private getSecret(): string {
    if (envs.JWT_SECRET) {
      return envs.JWT_SECRET;
    }

    if (envs.NODE_ENV === 'production') {
      throw new UnauthorizedException('JWT_SECRET no configurado');
    }

    return 'dev-only-change-me';
  }

  private parseExpiresIn(value: string): number {
    const match = /^(\d+)([smhd])?$/.exec(value);
    if (!match) {
      return 86400;
    }

    const amount = Number(match[1]);
    const unit = match[2] ?? 's';
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };

    return amount * multipliers[unit];
  }
}
