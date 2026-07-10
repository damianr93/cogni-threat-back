import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

/**
 * Reversible encryption for operational secrets stored in the database.
 *
 * Uses AES-256-GCM (authenticated encryption). The 32-byte key is derived from
 * SECRETS_MASTER_KEY, which must stay in env (root of trust). If the master key
 * is absent the service degrades safely: `isEnabled` is false and callers fall
 * back to reading secrets straight from env.
 *
 * Stored format: `iv:authTag:ciphertext`, each segment base64.
 */
@Injectable()
export class SecretsCryptoService {
  private readonly logger = new Logger(SecretsCryptoService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12;
  private readonly key: Buffer | null;

  constructor() {
    this.key = this.resolveKey();
    if (!this.key) {
      this.logger.warn(
        'SECRETS_MASTER_KEY not configured — encrypted secret store disabled, falling back to env only.',
      );
    }
  }

  get isEnabled(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.key) {
      throw new Error(
        'Secret encryption unavailable: SECRETS_MASTER_KEY not configured',
      );
    }
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): string {
    if (!this.key) {
      throw new Error(
        'Secret decryption unavailable: SECRETS_MASTER_KEY not configured',
      );
    }
    const [ivB64, tagB64, dataB64] = payload.split(':');
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('Malformed encrypted secret payload');
    }
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(dataB64, 'base64');
    const decipher = createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Derives a fixed 32-byte key from the configured master secret. Any string
   * works; a single SHA-256 pass normalizes it to the required length. The
   * master value is expected to be high-entropy random (see env docs).
   */
  private resolveKey(): Buffer | null {
    // Read straight from process.env: this is a bootstrap secret (see env docs),
    // populated by dotenv when libs/config is imported at startup. Reading it here
    // rather than through the cached `envs` object keeps the service testable in
    // isolation without requiring the full env schema (e.g. DATABASE_URL).
    const raw = process.env.SECRETS_MASTER_KEY;
    if (!raw || raw.trim().length === 0) {
      return null;
    }
    return createHash('sha256').update(raw, 'utf8').digest();
  }
}
