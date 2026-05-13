import { SecretsService } from './secrets.service';

function makeService(opts: { enabled: boolean; dbRow?: string | null }) {
  const crypto = {
    isEnabled: opts.enabled,
    encrypt: (v: string) => `enc(${v})`,
    decrypt: (c: string) => c.replace(/^enc\(/, '').replace(/\)$/, ''),
  } as any;

  const prisma = {
    platformSecret: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.dbRow ? { key: 'nvd_api_key', encryptedValue: opts.dbRow } : null),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;

  return { svc: new SecretsService(prisma, crypto), prisma, crypto };
}

describe('SecretsService', () => {
  it('prefers the encrypted DB value over env', async () => {
    const { svc } = makeService({ enabled: true, dbRow: 'enc(db-value)' });
    await expect(svc.get('nvd_api_key')).resolves.toBe('db-value');
  });

  it('falls back to env when there is no DB row', async () => {
    const { svc } = makeService({ enabled: true, dbRow: null });
    await expect(svc.get('nvd_api_key')).resolves.toBe(process.env.NVD_API_KEY);
  });

  it('skips the DB entirely when the store is disabled', async () => {
    const { svc, prisma } = makeService({ enabled: false });
    await svc.get('nvd_api_key');
    expect(prisma.platformSecret.findUnique).not.toHaveBeenCalled();
  });

  it('refuses to store a secret when the store is disabled', async () => {
    const { svc } = makeService({ enabled: false });
    await expect(svc.set('nvd_api_key', 'x')).rejects.toThrow();
  });

  it('never exposes plaintext through describe()', async () => {
    const { svc } = makeService({ enabled: true, dbRow: 'enc(super-secret-value)' });
    const described = await svc.describe();
    const serialized = JSON.stringify(described);
    expect(serialized).not.toContain('super-secret-value');
  });
});
