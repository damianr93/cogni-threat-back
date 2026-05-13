import { VulnWatchProfilesService } from './vuln-watch-profiles.service';

describe('VulnWatchProfilesService', () => {
  function makeService() {
    const store = new Map<string, any>();
    let profileSeq = 0;

    const prisma = {
      vulnWatchProfile: {
        findMany: jest.fn(async ({ where }: any) =>
          Array.from(store.values()).filter((p) => {
            if (where.userId && p.userId !== where.userId) return false;
            if (where.id?.in) return where.id.in.includes(p.id);
            return true;
          }),
        ),
        findFirst: jest.fn(async ({ where }: any) =>
          Array.from(store.values()).find((p) => p.id === where.id && p.userId === where.userId) ?? null,
        ),
        create: jest.fn(async ({ data, include }: any) => {
          const id = `profile-${++profileSeq}`;
          const row = {
            id,
            userId: data.userId,
            name: data.name,
            description: data.description,
            environment: data.environment,
            items: (data.items?.create ?? []).map((item: any, idx: number) => ({
              id: `item-${idx}`,
              profileId: id,
              ...item,
            })),
          };
          store.set(id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data, include }: any) => {
          const row = store.get(where.id);
          Object.assign(row, {
            name: data.name,
            description: data.description,
            environment: data.environment,
            items: (data.items?.create ?? []).map((item: any, idx: number) => ({
              id: `item-${idx}`,
              profileId: where.id,
              ...item,
            })),
          });
          return row;
        }),
        delete: jest.fn(async ({ where }: any) => {
          store.delete(where.id);
        }),
      },
      vulnWatchProfileItem: {
        deleteMany: jest.fn(async ({ where }: any) => {
          const row = store.get(where.profileId);
          if (row) row.items = [];
        }),
      },
    };

    return { service: new VulnWatchProfilesService(prisma as never), store };
  }

  it('validateProfileIds rejects unknown ids', async () => {
    const { service } = makeService();
    await expect(service.validateProfileIds('user-1', ['missing'])).rejects.toThrow();
  });

  it('creates and validates owned profiles', async () => {
    const { service } = makeService();
    const created = await service.create('user-1', {
      name: 'Stack web',
      environment: 'APP',
      items: [{ label: 'lodash', query: 'lodash' }],
    });
    const validated = await service.validateProfileIds('user-1', [created.id]);
    expect(validated).toHaveLength(1);
  });
});
