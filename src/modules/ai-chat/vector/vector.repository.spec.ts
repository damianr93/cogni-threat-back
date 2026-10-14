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
