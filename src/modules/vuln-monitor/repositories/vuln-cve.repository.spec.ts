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
