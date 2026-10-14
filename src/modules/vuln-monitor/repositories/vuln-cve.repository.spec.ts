import { VulnCveRepository } from './vuln-cve.repository';

function makeRepo() {
  const executeRaw = jest.fn().mockResolvedValue(1);
  const prisma = { $executeRaw: executeRaw };
  const repo = new VulnCveRepository(prisma as never);
  const sqlOf = (callIndex = 0) =>
    (executeRaw.mock.calls[callIndex][0] as string[]).join('?');
  return { repo, executeRaw, sqlOf };
}

describe('VulnCveRepository.bulkUpdateEpss', () => {
  it('makes no database call for an empty batch', async () => {
    const { repo, executeRaw } = makeRepo();

    await repo.bulkUpdateEpss([]);

    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('quotes the camelCase columns of vuln_cves', async () => {
    const { repo, executeRaw, sqlOf } = makeRepo();

    await repo.bulkUpdateEpss([
      { cveId: 'CVE-2024-0001', epss: 0.5, percentile: 0.9 },
    ]);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const sql = sqlOf();
    expect(sql).toContain('"epssScore"');
    expect(sql).toContain('"epssPercentile"');
    expect(sql).toContain('"cveId"');
    expect(sql).not.toMatch(/epss_score|epss_percentile|cve_id\b\s*=/);
  });

  it('does not write updatedAt so the RAG cursor is not advanced', async () => {
    const { repo, sqlOf } = makeRepo();

    await repo.bulkUpdateEpss([
      { cveId: 'CVE-2024-0001', epss: 0.5, percentile: 0.9 },
    ]);

    const sql = sqlOf();
    expect(sql).not.toMatch(/updatedAt|updated_at/i);
  });

  it('passes the batch values as bound parameters', async () => {
    const { repo, executeRaw } = makeRepo();

    await repo.bulkUpdateEpss([
      { cveId: 'CVE-2024-0001', epss: 0.5, percentile: 0.9 },
      { cveId: 'CVE-2024-0002', epss: 0.1, percentile: 0.2 },
    ]);

    const [, ids, scores, percentiles] = executeRaw.mock.calls[0];
    expect(ids).toEqual(['CVE-2024-0001', 'CVE-2024-0002']);
    expect(scores).toEqual([0.5, 0.1]);
    expect(percentiles).toEqual([0.9, 0.2]);
  });
});

describe('VulnCveRepository.upsert severity merge', () => {
  function makeUpsertRepo(existing: Record<string, unknown> | null) {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      vulnCve: {
        findFirst: jest.fn().mockResolvedValue(
          existing && {
            id: 'CVE-2024-0001',
            sources: ['nvd'],
            isKev: false,
            modifiedAt: null,
            description: null,
            title: null,
            cveId: 'CVE-2024-0001',
            cvssScore: null,
            cvssVector: null,
            cvssVersion: null,
            severity: null,
            epssScore: null,
            epssPercentile: null,
            ...existing,
          },
        ),
        update,
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const repo = new VulnCveRepository(prisma as never);
    const severityWritten = () => update.mock.calls[0][0].data.severity;
    return { repo, update, severityWritten };
  }

  const incoming = (extra: Record<string, unknown>) => ({
    id: 'CVE-2024-0001',
    cveId: 'CVE-2024-0001',
    sources: ['osv'],
    ...extra,
  });

  it('keeps the existing severity when the merged score is null', async () => {
    const { repo, severityWritten } = makeUpsertRepo({ severity: 'HIGH' });

    await repo.upsert(incoming({ cvssScore: null, severity: null }));

    expect(severityWritten()).toBe('HIGH');
  });

  it('keeps the existing severity over an incoming label when the merged score is null', async () => {
    const { repo, severityWritten } = makeUpsertRepo({ severity: 'HIGH' });

    await repo.upsert(incoming({ cvssScore: null, severity: 'LOW' }));

    expect(severityWritten()).toBe('HIGH');
  });

  it('adopts a label-only incoming severity when none exists and the merged score is null', async () => {
    const { repo, severityWritten } = makeUpsertRepo({ severity: null });

    await repo.upsert(incoming({ cvssScore: null, severity: 'MEDIUM' }));

    expect(severityWritten()).toBe('MEDIUM');
  });

  it('follows the incoming severity when its score wins the merge', async () => {
    const { repo, severityWritten } = makeUpsertRepo({
      cvssScore: 5,
      severity: 'MEDIUM',
    });

    await repo.upsert(incoming({ cvssScore: 9.8, severity: 'CRITICAL' }));

    expect(severityWritten()).toBe('CRITICAL');
  });

  it('keeps the existing severity when the existing score wins the merge', async () => {
    const { repo, severityWritten } = makeUpsertRepo({
      cvssScore: 8,
      severity: 'HIGH',
    });

    await repo.upsert(incoming({ cvssScore: 3, severity: 'LOW' }));

    expect(severityWritten()).toBe('HIGH');
  });

  it('leaves severity null when neither side supplies one', async () => {
    const { repo, severityWritten } = makeUpsertRepo({
      cvssScore: 7.5,
      severity: null,
    });

    await repo.upsert(incoming({ cvssScore: null, severity: null }));

    expect(severityWritten()).toBeNull();
  });
});

describe('VulnCveRepository.searchForChat', () => {
  function makeSearchRepo(
    options: { productIds?: string[]; total?: number; rows?: unknown[] } = {},
  ) {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const queryRaw = jest.fn((query: { sql: string; values: unknown[] }) => {
      queries.push({ sql: query.sql, values: query.values });
      if (/count\(\*\)/i.test(query.sql)) {
        return Promise.resolve([{ count: options.total ?? 0 }]);
      }
      if (/affectedPackages/.test(query.sql)) {
        return Promise.resolve(
          (options.productIds ?? []).map((id) => ({ id })),
        );
      }
      return Promise.resolve(options.rows ?? []);
    });
    const db = { $queryRaw: queryRaw };
    const repo = new VulnCveRepository({} as never);
    const dataQuery = () =>
      queries.find(
        (q) =>
          !/count\(\*\)/i.test(q.sql) && !/affectedPackages"::text/.test(q.sql),
      )!;
    const productQuery = () =>
      queries.find((q) => /affectedPackages"::text/.test(q.sql));
    return { repo, db: db as never, queries, dataQuery, productQuery };
  }

  it('matches a CVE id exactly, upper-cased, without ILIKE', async () => {
    const { repo, db, dataQuery } = makeSearchRepo();

    await repo.searchForChat({ query: 'cve-2024-3400', limit: 5 }, db);

    const { sql, values } = dataQuery();
    expect(sql).toContain('"cveId" =');
    expect(sql).not.toMatch(/ILIKE/i);
    expect(values).toContain('CVE-2024-3400');
  });

  it('escapes % and _ in text search and declares the escape character', async () => {
    const { repo, db, dataQuery } = makeSearchRepo();

    await repo.searchForChat({ query: '50%_off!', limit: 5 }, db);

    const { sql, values } = dataQuery();
    expect(sql).toContain("ESCAPE '!'");
    expect(sql).toMatch(/title ILIKE/);
    expect(sql).toMatch(/description ILIKE/);
    expect(values).toContain('%50!%!_off!!%');
    expect(sql).not.toContain('50%');
  });

  it('quotes the camelCase columns and binds filters as parameters', async () => {
    const { repo, db, dataQuery } = makeSearchRepo();
    const since = new Date('2024-01-01T00:00:00Z');

    await repo.searchForChat(
      {
        severity: 'HIGH',
        isKev: true,
        minCvss: 7.5,
        minEpss: 0.2,
        publishedSince: since,
        sort: 'epss',
        limit: 7,
      },
      db,
    );

    const { sql, values } = dataQuery();
    for (const col of [
      '"cvssScore"',
      '"epssScore"',
      '"isKev"',
      '"publishedAt"',
    ]) {
      expect(sql).toContain(col);
    }
    expect(sql).toMatch(/ORDER BY "epssScore" DESC NULLS LAST, id ASC/);
    expect(values).toEqual(
      expect.arrayContaining(['HIGH', true, 7.5, 0.2, since, 7]),
    );
  });

  it('returns the total, rows and productCapped=false without a product filter', async () => {
    const rows = [{ id: 'CVE-2024-0001' }];
    const { repo, db, productQuery } = makeSearchRepo({ total: 42, rows });

    const result = await repo.searchForChat({ limit: 5 }, db);

    expect(result).toEqual({ total: 42, productCapped: false, data: rows });
    expect(productQuery()).toBeUndefined();
  });

  it('scans products over at most 500 ids and narrows the search to them', async () => {
    const { repo, db, productQuery, dataQuery } = makeSearchRepo({
      productIds: ['CVE-A', 'CVE-B'],
      total: 2,
      rows: [{ id: 'CVE-A' }],
    });

    const result = await repo.searchForChat(
      { product: 'fort_inet%', limit: 5 },
      db,
    );

    const scan = productQuery()!;
    expect(scan.sql).toContain("ESCAPE '!'");
    expect(scan.sql).toMatch(/ORDER BY "modifiedAt" DESC NULLS LAST/);
    expect(scan.values).toEqual(['%fort!_inet!%%', 500]);
    expect(dataQuery().values).toContainEqual(['CVE-A', 'CVE-B']);
    expect(result.productCapped).toBe(false);
  });

  it('flags productCapped when the scan hits the 500 id cap', async () => {
    const ids = Array.from({ length: 500 }, (_, i) => `CVE-${i}`);
    const { repo, db } = makeSearchRepo({ productIds: ids, total: 500 });

    const result = await repo.searchForChat(
      { product: 'openssl', limit: 5 },
      db,
    );

    expect(result.productCapped).toBe(true);
  });

  it('skips the main query when no CVE matches the product', async () => {
    const { repo, db, queries } = makeSearchRepo({ productIds: [] });

    const result = await repo.searchForChat(
      { product: 'nothing', limit: 5 },
      db,
    );

    expect(result).toEqual({ total: 0, productCapped: false, data: [] });
    expect(queries).toHaveLength(1);
  });
});
