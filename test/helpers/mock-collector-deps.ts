import { createInMemorySyncStateStore } from './mock-prisma-sync-state';
import { SyncStateRepository } from '../../src/modules/vuln-monitor/repositories/sync-state.repository';

export function makeSyncStateRepository(initial?: Parameters<typeof createInMemorySyncStateStore>[0]) {
  const store = createInMemorySyncStateStore(initial);
  const repo = new SyncStateRepository(store.prisma as never);
  return { repo, store };
}

export function makeCveRepo() {
  const upsert = jest.fn().mockResolvedValue({ isNew: true });
  const bulkUpdateEpss = jest.fn().mockResolvedValue(undefined);
  return {
    cveRepo: { upsert, bulkUpdateEpss },
    upsert,
    bulkUpdateEpss,
  };
}

export function makeSecrets(apiKey?: string) {
  return {
    get: jest.fn().mockImplementation(async (key: string) => {
      if (key === 'nvd_api_key' || key === 'github_token') return apiKey ?? undefined;
      return undefined;
    }),
  };
}
