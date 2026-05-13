import { SecretsCryptoService } from './secrets-crypto.service';

describe('SecretsCryptoService', () => {
  const KEY = 'test-master-key-1234567890';
  let original: string | undefined;

  beforeAll(() => {
    original = process.env.SECRETS_MASTER_KEY;
  });

  afterAll(() => {
    if (original === undefined) {
      delete process.env.SECRETS_MASTER_KEY;
    } else {
      process.env.SECRETS_MASTER_KEY = original;
    }
  });

  it('round-trips a value through encrypt/decrypt', () => {
    process.env.SECRETS_MASTER_KEY = KEY;
    const svc = new SecretsCryptoService();

    expect(svc.isEnabled).toBe(true);

    const plaintext = 'ghp_supersecrettoken';
    const encrypted = svc.encrypt(plaintext);

    expect(encrypted).not.toContain(plaintext);
    expect(encrypted.split(':')).toHaveLength(3);
    expect(svc.decrypt(encrypted)).toBe(plaintext);
  });

  it('uses a random IV so ciphertext differs each call', () => {
    process.env.SECRETS_MASTER_KEY = KEY;
    const svc = new SecretsCryptoService();

    expect(svc.encrypt('same-input')).not.toBe(svc.encrypt('same-input'));
  });

  it('disables itself when the master key is absent', () => {
    delete process.env.SECRETS_MASTER_KEY;
    const svc = new SecretsCryptoService();

    expect(svc.isEnabled).toBe(false);
    expect(() => svc.encrypt('x')).toThrow();
  });

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    process.env.SECRETS_MASTER_KEY = KEY;
    const svc = new SecretsCryptoService();

    const encrypted = svc.encrypt('secret');
    const [iv, tag] = encrypted.split(':');
    const tampered = [iv, tag, Buffer.from('tampered-data').toString('base64')].join(':');

    expect(() => svc.decrypt(tampered)).toThrow();
  });
});
