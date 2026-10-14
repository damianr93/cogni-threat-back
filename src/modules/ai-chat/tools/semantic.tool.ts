import { z } from 'zod';
import { OllamaEmbeddingsProvider } from '../providers/ollama-embeddings.provider';
import { VectorRepository } from '../vector/vector.repository';
import { ToolResult } from './fit-result';
import { cut } from './tool-args';
import { ChatTool, defineTool, limitOf } from './tool.types';

export interface SemanticToolDeps {
  vectors: Pick<VectorRepository, 'findSimilar'>;
  embeddings: Pick<OllamaEmbeddingsProvider, 'generateQueryEmbedding'>;
}

const CATEGORIES = ['ransomware', 'vuln-monitor', 'actors'] as const;
const MAX_K = 10;
/** Telegram and victims are answered by structured tools, not by vectors. */
const EXCLUDED_PREFIXES = ['telegram:', 'ransomware:victim:'];

const schema = z.object({
  query: z.string().trim().min(1).max(300),
  categories: z.array(z.enum(CATEGORIES)).optional(),
  k: limitOf(6, MAX_K),
});

const nonEmpty = <T>(list: T[] | undefined) =>
  list && list.length > 0 ? list : undefined;

export function createSemanticTools({
  vectors,
  embeddings,
}: SemanticToolDeps): ChatTool[] {
  const semanticSearch = defineTool({
    name: 'semantic_search',
    description:
      'Meaning-based search over embedded knowledge: ransomware groups, threat actors and KEV CVEs. Use when no structured tool fits the question.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language query.' },
        categories: {
          type: 'array',
          items: { type: 'string', enum: [...CATEGORIES] },
          description: 'Optional category filter.',
        },
        k: { type: 'number', description: `1-${MAX_K}, default 6.` },
      },
      required: ['query'],
    },
    schema,
    async run({ query, categories, k }, context): Promise<ToolResult> {
      const embedding = await embeddings.generateQueryEmbedding(query);
      const chunks = await vectors.findSimilar({
        embedding,
        k,
        // The UI scope the user selected always wins over model-chosen filters.
        categories: nonEmpty(context.categories) ?? categories,
        sources: nonEmpty(context.sources),
        excludeSourcePrefixes: EXCLUDED_PREFIXES,
      });
      return {
        items: chunks.map((c) => ({
          source: c.source,
          category: c.category,
          distance: Math.round(c.distance * 10000) / 10000,
          text: cut(c.text, 400),
        })),
      };
    },
  });

  return [semanticSearch];
}
