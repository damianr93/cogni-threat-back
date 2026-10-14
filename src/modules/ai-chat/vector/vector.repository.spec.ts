import { VectorRepository } from './vector.repository';

describe('VectorRepository.findSimilar', () => {
  function setup() {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    const repo = new VectorRepository();
    (repo as unknown as { pool: unknown }).pool = {
      connect: jest.fn().mockResolvedValue(client),
    };
    return { repo, client };
  }

  it('excludes source prefixes with a parameterised NOT LIKE ANY', async () => {
    const { repo, client } = setup();

    await repo.findSimilar({
      embedding: [0.1],
      k: 4,
      excludeSourcePrefixes: ['telegram:', 'a_b%'],
    });

    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/NOT \(source LIKE ANY\(\$2\)\)/);
    expect(params).toEqual([4, ['telegram:%', 'a\\_b\\%%']]);
    expect(client.release).toHaveBeenCalled();
  });

  it('adds no exclusion clause when none is requested', async () => {
    const { repo, client } = setup();

    await repo.findSimilar({ embedding: [0.1], k: 4 });

    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('LIKE');
    expect(params).toEqual([4]);
  });
});

describe('VectorRepository purge support', () => {
  function setup(rows: unknown[] = []) {
    const client = {
      query: jest.fn().mockResolvedValue({ rows }),
      release: jest.fn(),
    };
    const repo = new VectorRepository();
    (repo as unknown as { pool: unknown }).pool = {
      connect: jest.fn().mockResolvedValue(client),
    };
    return { repo, client };
  }

  it('maps the size split from bigint strings to numbers', async () => {
    const { repo, client } = setup([
      {
        total_bytes: '1000',
        table_bytes: '100',
        toast_bytes: '600',
        index_bytes: '300',
        avg_embedding_bytes: '8192',
      },
    ]);

    await expect(repo.getSizeReport()).resolves.toEqual({
      totalBytes: 1000,
      tableBytes: 100,
      toastBytes: 600,
      indexBytes: 300,
      avgEmbeddingBytes: 8192,
    });
    expect(client.release).toHaveBeenCalled();
  });

  it('reports a null average when the sample is empty', async () => {
    const { repo } = setup([
      {
        total_bytes: '0',
        table_bytes: '0',
        toast_bytes: '0',
        index_bytes: '0',
        avg_embedding_bytes: null,
      },
    ]);

    const report = await repo.getSizeReport();

    expect(report.avgEmbeddingBytes).toBeNull();
  });

  it('withClient hands out a pooled client and always releases it', async () => {
    const { repo, client } = setup();

    await expect(
      repo.withClient(() => Promise.reject(new Error('x'))),
    ).rejects.toThrow('x');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('VectorRepository.listSources scope exclusion', () => {
  function setup() {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [{ total: '0' }] }),
      release: jest.fn(),
    };
    const repo = new VectorRepository();
    (repo as unknown as { pool: unknown }).pool = {
      connect: jest.fn().mockResolvedValue(client),
    };
    return { repo, client };
  }

  it('excludes gated prefixes from the count and the page with escaped patterns', async () => {
    const { repo, client } = setup();

    await repo.listSources({
      limit: 5,
      offset: 0,
      excludeSourcePrefixes: ['telegram:', 'a_b'],
    });

    const [countSql, countParams] = client.query.mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(countSql).toContain('NOT (source LIKE ANY($1))');
    expect(countParams[0]).toEqual(['telegram:%', 'a\\_b%']);
    const [pageSql, pageParams] = client.query.mock.calls[1] as [
      string,
      unknown[],
    ];
    expect(pageSql).toContain('NOT (source LIKE ANY($1))');
    expect(pageParams).toEqual([['telegram:%', 'a\\_b%'], 5, 0]);
  });

  it('escapes LIKE wildcards in the search term', async () => {
    const { repo, client } = setup();

    await repo.listSources({ limit: 5, offset: 0, search: '50%_!' });

    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("source ILIKE $2 ESCAPE '!'");
    expect(sql).toContain("text ILIKE $2 ESCAPE '!'");
    expect(params.slice(0, 2)).toEqual(['50%_!', '%50!%!_!!%']);
  });

  it('adds no exclusion clause when no prefix is gated', async () => {
    const { repo, client } = setup();

    await repo.listSources({ limit: 5, offset: 0 });

    const [countSql, countParams] = client.query.mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(countSql).not.toContain('LIKE ANY');
    expect(countParams).toEqual([5, 0]);
  });
});

describe('VectorRepository.existingSources', () => {
  function setup(rows: unknown[]) {
    const client = {
      query: jest.fn().mockResolvedValue({ rows }),
      release: jest.fn(),
    };
    const repo = new VectorRepository();
    (repo as unknown as { pool: unknown }).pool = {
      connect: jest.fn().mockResolvedValue(client),
    };
    return { repo, client };
  }

  it('returns the subset of sources that have vectors', async () => {
    const { repo, client } = setup([{ source: 'vuln-monitor:cve:CVE-1' }]);

    const found = await repo.existingSources([
      'vuln-monitor:cve:CVE-1',
      'vuln-monitor:cve:CVE-2',
    ]);

    expect([...found]).toEqual(['vuln-monitor:cve:CVE-1']);
    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('source = ANY($1)');
    expect(params).toEqual([
      ['vuln-monitor:cve:CVE-1', 'vuln-monitor:cve:CVE-2'],
    ]);
    expect(client.release).toHaveBeenCalled();
  });

  it('skips the query for an empty list', async () => {
    const { repo, client } = setup([]);

    const found = await repo.existingSources([]);

    expect(found.size).toBe(0);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('VectorRepository.findTextBySources', () => {
  function setup(rows: unknown[]) {
    const client = {
      query: jest.fn().mockResolvedValue({ rows }),
      release: jest.fn(),
    };
    const repo = new VectorRepository();
    (repo as unknown as { pool: unknown }).pool = {
      connect: jest.fn().mockResolvedValue(client),
    };
    return { repo, client };
  }

  it('returns the first chunks of each source in chunk order', async () => {
    const { repo, client } = setup([
      { source: 's1', category: 'actors', text: 'one' },
      { source: 's1', category: 'actors', text: 'two' },
    ]);

    const rows = await repo.findTextBySources(['s1', 's2'], 2);

    expect(rows).toEqual([
      { source: 's1', category: 'actors', text: 'one' },
      { source: 's1', category: 'actors', text: 'two' },
    ]);
    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('source = ANY($1)');
    expect(sql).toContain('PARTITION BY source ORDER BY chunk_index');
    expect(sql).toContain('<= $2');
    expect(params).toEqual([['s1', 's2'], 2]);
    expect(client.release).toHaveBeenCalled();
  });

  it('skips the query for an empty selection', async () => {
    const { repo, client } = setup([]);

    expect(await repo.findTextBySources([])).toEqual([]);
    expect(client.query).not.toHaveBeenCalled();
  });
});
