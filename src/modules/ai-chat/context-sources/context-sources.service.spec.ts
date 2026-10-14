import { Prisma } from '@prisma/client';
import { ContextSourcesService } from './context-sources.service';

const mockEnvs = {
  RAG_CVE_EMBED_MODE: 'kev',
  RAG_RANSOMWARE_VICTIM_EMBED_MODE: 'none',
  RAG_TELEGRAM_EMBED_MODE: 'none',
};

jest.mock('libs/config/src/envs', () => ({
  get envs() {
    return mockEnvs;
  },
}));

type Rows = Partial<{
  cves: unknown[];
  channels: unknown[];
  victims: unknown[];
}>;

const timeout = () =>
  Object.assign(new Error('canceling statement'), { meta: { code: '57014' } });

function setup(
  sql: Rows = {},
  vector: {
    items?: Array<{ source: string; category: string; summary: string }>;
    total?: number;
    existing?: string[];
  } = {},
) {
  const failures: Partial<Record<keyof Rows, Error>> = {};
  const queries: Prisma.Sql[] = [];
  const tx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn((q: Prisma.Sql) => {
      queries.push(q);
      const table = q.sql.includes('vuln_cves')
        ? 'cves'
        : q.sql.includes('telegram_channel_messages')
          ? 'channels'
          : 'victims';
      return failures[table]
        ? Promise.reject(failures[table])
        : Promise.resolve(sql[table] ?? []);
    }),
  };
  const prisma = {
    $transaction: jest.fn((work: (t: unknown) => unknown) => work(tx)),
  };
  const vectors = {
    listSources: jest.fn().mockResolvedValue({
      items: vector.items ?? [],
      total: vector.total ?? vector.items?.length ?? 0,
    }),
    existingSources: jest
      .fn()
      .mockResolvedValue(new Set<string>(vector.existing ?? [])),
  };
  const service = new ContextSourcesService(prisma as never, vectors as never);
  const queryOn = (table: string) => queries.find((q) => q.sql.includes(table));
  return { service, tx, prisma, vectors, failures, queries, queryOn };
}

const cveRow = (id: string, title: string | null = 'Some flaw') => ({
  id,
  title,
});

beforeEach(() => {
  mockEnvs.RAG_CVE_EMBED_MODE = 'kev';
  mockEnvs.RAG_RANSOMWARE_VICTIM_EMBED_MODE = 'none';
  mockEnvs.RAG_TELEGRAM_EMBED_MODE = 'none';
});

describe('ContextSourcesService: CVEs from SQL', () => {
  it('lists a non-embedded CVE found by an id fragment', async () => {
    const { service, queryOn } = setup({
      cves: [cveRow('CVE-2024-9999', 'Remote code execution in Foo')],
    });

    const page = await service.list({ search: 'CVE-2024-99' });

    expect(page.items).toEqual([
      {
        id: 'vuln-monitor:cve:CVE-2024-9999',
        label: 'CVE-2024-9999',
        category: 'vuln-monitor',
        summary: 'Remote code execution in Foo',
      },
    ]);
    expect(page.total).toBe(1);
    expect(queryOn('vuln_cves')?.sql).toContain('id ILIKE');
  });

  it('escapes LIKE wildcards in the search term', async () => {
    const { service, queryOn } = setup();

    await service.list({ search: '50%_!' });

    expect(queryOn('vuln_cves')?.values).toContain('%50!%!_!!%');
    expect(queryOn('vuln_cves')?.sql).toContain("ESCAPE '!'");
    expect(queryOn('ransomware_victims_data')?.values).toContain('%50!%!_!!%');
  });

  it('caps the SQL result set with a LIMIT', async () => {
    const { service, queryOn } = setup({
      cves: Array.from({ length: 50 }, (_, i) =>
        cveRow(`CVE-2024-${1000 + i}`),
      ),
    });

    const page = await service.list({ search: 'CVE-2024', limit: 50 });

    expect(queryOn('vuln_cves')?.values).toContain(50);
    expect(page.items).toHaveLength(50);
    expect(page.total).toBe(50);
  });

  it('does not query CVEs or victims without a search term', async () => {
    const { service, queryOn } = setup({ channels: [{ channelName: 'c1' }] });

    const page = await service.list({});

    expect(queryOn('vuln_cves')).toBeUndefined();
    expect(queryOn('ransomware_victims_data')).toBeUndefined();
    expect(page.items.map((i) => i.id)).toEqual(['telegram:channel:c1']);
  });

  it('lists an embedded KEV CVE only once', async () => {
    const kev = 'vuln-monitor:cve:CVE-2024-0001';
    const { service, vectors } = setup(
      { cves: [cveRow('CVE-2024-0001'), cveRow('CVE-2024-0002')] },
      {
        items: [{ source: kev, category: 'vuln-monitor', summary: 'KEV one' }],
        existing: [kev],
      },
    );

    const page = await service.list({ search: 'CVE-2024' });

    expect(vectors.existingSources).toHaveBeenCalledWith([
      kev,
      'vuln-monitor:cve:CVE-2024-0002',
    ]);
    expect(page.items.map((i) => i.id)).toEqual([
      kev,
      'vuln-monitor:cve:CVE-2024-0002',
    ]);
    expect(page.total).toBe(2);
  });
});

describe('ContextSourcesService: channels and victims', () => {
  it('lists Telegram channels as channel sources in mode none', async () => {
    const { service, queryOn } = setup({
      channels: [{ channelName: 'threat_intel' }, { channelName: 'leaks' }],
    });

    const page = await service.list({ search: 'thr' });

    expect(page.items).toEqual([
      {
        id: 'telegram:channel:threat_intel',
        label: 'threat_intel',
        category: 'telegram',
        summary: 'Canal Telegram: threat_intel',
      },
      {
        id: 'telegram:channel:leaks',
        label: 'leaks',
        category: 'telegram',
        summary: 'Canal Telegram: leaks',
      },
    ]);
    expect(queryOn('telegram_channel_messages')?.values).toContain('%thr%');
    expect(queryOn('telegram_channel_messages')?.sql).toContain(
      'GROUP BY "channelName"',
    );
  });

  it('leaves channels to the vectors when Telegram is fully embedded', async () => {
    mockEnvs.RAG_TELEGRAM_EMBED_MODE = 'all';
    const { service, queryOn } = setup({ channels: [{ channelName: 'c1' }] });

    const page = await service.list({});

    expect(queryOn('telegram_channel_messages')).toBeUndefined();
    expect(page.items).toEqual([]);
  });

  it('lists victims keyed by ransomwareLiveId in mode none', async () => {
    const { service, queryOn } = setup({
      victims: [
        { ransomwareLiveId: 'abc123', victim: 'Acme Corp', group: 'lockbit' },
      ],
    });

    const page = await service.list({ search: 'acme' });

    expect(page.items).toEqual([
      {
        id: 'ransomware:victim:abc123',
        label: 'Acme Corp',
        category: 'ransomware',
        summary: 'Víctima ransomware: Acme Corp (lockbit)',
      },
    ]);
    expect(queryOn('ransomware_victims_data')?.values).toContain('%acme%');
  });

  it('skips victims already embedded when victims are fully embedded', async () => {
    mockEnvs.RAG_RANSOMWARE_VICTIM_EMBED_MODE = 'all';
    const { service, queryOn } = setup({
      victims: [{ ransomwareLiveId: 'abc123', victim: 'Acme', group: 'g' }],
    });

    await service.list({ search: 'acme' });

    expect(queryOn('ransomware_victims_data')).toBeUndefined();
  });

  it('runs only the SQL sources that match the category filter', async () => {
    const { service, queries, vectors } = setup({
      channels: [{ channelName: 'c1' }],
    });

    const page = await service.list({ search: 'x', category: 'actors' });

    expect(queries).toHaveLength(0);
    expect(vectors.listSources).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'actors' }),
    );
    expect(page.items).toEqual([]);
  });
});

describe('ContextSourcesService: timeouts and failures', () => {
  it('applies a 2 s statement timeout to each SQL source', async () => {
    const { service, tx } = setup();

    await service.list({ search: 'x' });

    const timeouts = tx.$executeRawUnsafe.mock.calls.map(([sql]) => sql);
    expect(timeouts).toEqual([
      'SET LOCAL statement_timeout = 2000',
      'SET LOCAL statement_timeout = 2000',
      'SET LOCAL statement_timeout = 2000',
    ]);
  });

  it('drops a source that times out and keeps the others', async () => {
    const { service, failures } = setup({
      cves: [cveRow('CVE-2024-0003')],
      channels: [{ channelName: 'c1' }],
    });
    failures.victims = timeout();

    const page = await service.list({ search: 'x' });

    expect(page.items.map((i) => i.id)).toEqual([
      'telegram:channel:c1',
      'vuln-monitor:cve:CVE-2024-0003',
    ]);
  });

  it('drops a source that fails for any other reason', async () => {
    const { service, failures } = setup({ channels: [{ channelName: 'c1' }] });
    failures.cves = new Error('connection reset');

    const page = await service.list({ search: 'x' });

    expect(page.items.map((i) => i.id)).toEqual(['telegram:channel:c1']);
  });
});

describe('ContextSourcesService: merge and pagination', () => {
  const vec = (n: number) => ({
    source: `actors:actor:a${n}`,
    category: 'actors',
    summary: `Actor de amenaza: A${n}`,
  });

  it('puts vector sources first and maps them like before', async () => {
    const { service } = setup(
      { channels: [{ channelName: 'c1' }] },
      { items: [vec(1)], total: 1 },
    );

    const page = await service.list({});

    expect(page).toEqual({
      items: [
        {
          id: 'actors:actor:a1',
          label: 'a1',
          category: 'actors',
          summary: 'Actor de amenaza: A1',
        },
        {
          id: 'telegram:channel:c1',
          label: 'c1',
          category: 'telegram',
          summary: 'Canal Telegram: c1',
        },
      ],
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('fills the rest of a page from SQL items after the vector items run out', async () => {
    const { service, vectors } = setup(
      { channels: [{ channelName: 'c1' }, { channelName: 'c2' }] },
      { items: [vec(1), vec(2)], total: 3 },
    );

    const page = await service.list({ page: 1, limit: 4 });

    expect(vectors.listSources).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 4, offset: 0 }),
    );
    expect(page.items.map((i) => i.id)).toEqual([
      'actors:actor:a1',
      'actors:actor:a2',
      'telegram:channel:c1',
      'telegram:channel:c2',
    ]);
    expect(page.total).toBe(5);
    expect(page.totalPages).toBe(2);
  });

  it('serves later pages entirely from SQL items', async () => {
    const { service } = setup(
      { channels: [{ channelName: 'c1' }, { channelName: 'c2' }] },
      { items: [], total: 3 },
    );

    const page = await service.list({ page: 3, limit: 2 });

    expect(page.items.map((i) => i.id)).toEqual(['telegram:channel:c2']);
    expect(page.page).toBe(3);
  });

  it('clamps limit to 1..50 and page to at least 1', async () => {
    const { service, vectors } = setup();

    const page = await service.list({ page: -3, limit: 500 });

    expect(vectors.listSources).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, offset: 0 }),
    );
    expect(page).toMatchObject({ page: 1, limit: 50, totalPages: 1 });
  });
});

describe('ContextSourcesService: vector scope', () => {
  it('excludes the gated prefixes from the vector listing', async () => {
    const { service, vectors } = setup();

    await service.list({});

    expect(vectors.listSources).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeSourcePrefixes: ['ransomware:victim:', 'telegram:'],
      }),
    );
  });

  it('also gates CVE vectors in mode none and nothing in mode all', async () => {
    mockEnvs.RAG_CVE_EMBED_MODE = 'none';
    const first = setup();
    await first.service.list({});
    expect(first.vectors.listSources).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeSourcePrefixes: [
          'vuln-monitor:cve:',
          'ransomware:victim:',
          'telegram:',
        ],
      }),
    );

    mockEnvs.RAG_CVE_EMBED_MODE = 'all';
    mockEnvs.RAG_RANSOMWARE_VICTIM_EMBED_MODE = 'all';
    mockEnvs.RAG_TELEGRAM_EMBED_MODE = 'all';
    const second = setup();
    await second.service.list({});
    expect(second.vectors.listSources).toHaveBeenCalledWith(
      expect.objectContaining({ excludeSourcePrefixes: undefined }),
    );
  });
});
