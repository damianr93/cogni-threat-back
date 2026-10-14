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
