import type { VulnSource } from '../../src/modules/vuln-monitor/repositories/sync-state.repository';

export interface SyncStateRow {
  source: VulnSource;
  lastSyncAt: Date | null;
  lastCursor: string | null;
  lastCount: number | null;
  errorCount: number;
  lastError: string | null;
  updatedAt: Date;
}

export function createInMemorySyncStateStore(initial: Partial<Record<VulnSource, Partial<SyncStateRow>>> = {}) {
  const rows = new Map<VulnSource, SyncStateRow>();

  for (const source of ['nvd', 'kev', 'github', 'osv', 'epss'] as VulnSource[]) {
    rows.set(source, {
      source,
      lastSyncAt: null,
      lastCursor: null,
      lastCount: null,
      errorCount: 0,
      lastError: null,
      updatedAt: new Date(),
      ...initial[source],
    });
  }

  return {
    rows,
    prisma: {
      vulnSyncState: {
        upsert: jest.fn(async ({ where, create }: { where: { source: VulnSource }; create: Partial<SyncStateRow> }) => {
          if (!rows.has(where.source)) {
            rows.set(where.source, {
              source: where.source,
              lastSyncAt: null,
              lastCursor: null,
              lastCount: null,
              errorCount: 0,
              lastError: null,
              updatedAt: new Date(),
              ...create,
            } as SyncStateRow);
          }
          return rows.get(where.source);
        }),
        findUnique: jest.fn(async ({ where }: { where: { source: VulnSource } }) => rows.get(where.source) ?? null),
        findMany: jest.fn(async () => Array.from(rows.values())),
        update: jest.fn(async ({ where, data }: { where: { source: VulnSource }; data: Record<string, unknown> }) => {
          const row = rows.get(where.source);
          if (!row) throw new Error(`Missing sync state for ${where.source}`);
          if (data.lastSyncAt !== undefined) row.lastSyncAt = data.lastSyncAt as Date | null;
          if (data.lastCursor !== undefined) row.lastCursor = data.lastCursor as string | null;
          if (data.lastCount !== undefined) row.lastCount = data.lastCount as number | null;
          if (data.lastError !== undefined) row.lastError = data.lastError as string | null;
          if (typeof data.errorCount === 'object' && data.errorCount !== null && 'increment' in data.errorCount) {
            row.errorCount += (data.errorCount as { increment: number }).increment;
          }
          row.updatedAt = new Date();
          return row;
        }),
      },
    },
  };
}
