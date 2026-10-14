import { jsonSchemaMismatches } from './schema-parity';
import { createSemanticTools } from './semantic.tool';
import { ToolContext } from '../rag/chat-orchestrator';
import { ToolRegistry } from './tool-registry';

function setup() {
  const vectors = {
    findSimilar: jest.fn().mockResolvedValue([]),
  };
  const embeddings = {
    generateQueryEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
  };
  const tools = createSemanticTools({ vectors, embeddings } as never);
  const registry = new ToolRegistry(tools);
  const run = (args: Record<string, unknown>, context: ToolContext = {}) =>
    registry.execute({ name: 'semantic_search', arguments: args }, context);
  return { vectors, embeddings, tools, run };
}

const EXCLUDED = ['telegram:', 'ransomware:victim:'];

describe('semantic_search', () => {
  it('is a single read-only tool with a lean English description', () => {
    const { tools } = setup();

    expect(tools.map((t) => t.name)).toEqual(['semantic_search']);
    expect(tools[0].description.length).toBeLessThanOrEqual(200);
    expect(jsonSchemaMismatches(tools[0])).toEqual([]);
  });

  it('embeds the query and searches with the model categories and excluded prefixes', async () => {
    const { vectors, embeddings, run } = setup();

    await run({ query: 'lockbit tactics', categories: ['ransomware'] });

    expect(embeddings.generateQueryEmbedding).toHaveBeenCalledWith(
      'lockbit tactics',
    );
    expect(vectors.findSimilar).toHaveBeenCalledWith({
      embedding: [0.1, 0.2],
      k: 6,
      categories: ['ransomware'],
      sources: undefined,
      excludeSourcePrefixes: EXCLUDED,
    });
  });

  it('lets the UI scope override model-chosen categories and sources', async () => {
    const { vectors, run } = setup();

    await run(
      { query: 'q', categories: ['actors'] },
      { categories: ['vuln-monitor'], sources: ['kev:CVE-1'] },
    );

    expect(vectors.findSimilar).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: ['vuln-monitor'],
        sources: ['kev:CVE-1'],
        excludeSourcePrefixes: EXCLUDED,
      }),
    );
  });

  it('falls back to the model categories when the UI scope is empty', async () => {
    const { vectors, run } = setup();

    await run({ query: 'q', categories: ['actors'] }, { categories: [] });

    expect(vectors.findSimilar.mock.calls[0][0].categories).toEqual(['actors']);
  });

  it.each([
    [undefined, 6],
    [3, 3],
    [50, 10],
    [0, 1],
  ])('maps k=%p to %p (1-10)', async (k, expected) => {
    const { vectors, run } = setup();

    await run({ query: 'q', k });

    expect(vectors.findSimilar.mock.calls[0][0].k).toBe(expected);
  });

  it.each([
    ['empty query', { query: '' }],
    ['over-long query', { query: 'q'.repeat(301) }],
    ['unknown category', { query: 'q', categories: ['telegram'] }],
    ['non-numeric k', { query: 'q', k: 'abc' }],
  ])('rejects %s without embedding', async (_label, args) => {
    const { embeddings, run } = setup();

    const result = await run(args);

    expect(result).toEqual({ error: expect.stringMatching(/invalid/i) });
    expect(embeddings.generateQueryEmbedding).not.toHaveBeenCalled();
  });

  it('returns compact passages with source, category and rounded distance', async () => {
    const { vectors, run } = setup();
    vectors.findSimilar.mockResolvedValue([
      {
        text: 't'.repeat(600),
        source: 'actors:APT29',
        category: 'actors',
        distance: 0.123456,
      },
    ]);

    expect(await run({ query: 'apt29' })).toEqual({
      items: [
        {
          source: 'actors:APT29',
          category: 'actors',
          distance: 0.1235,
          text: 't'.repeat(400) + '…',
        },
      ],
    });
  });
});
