import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { envs } from 'libs/config/src/envs';

export interface VectorChunk {
  text: string;
  source: string;
  category: string;
  distance: number;
}

export interface VectorSizeReport {
  totalBytes: number;
  tableBytes: number;
  toastBytes: number;
  indexBytes: number;
  /** Average embedding size from a 1% sample; null while the table is empty. */
  avgEmbeddingBytes: number | null;
}

export interface SourceItem {
  source: string;
  category: string;
  summary: string;
}

/** LIKE pattern matching every source that starts with `prefix`. */
const prefixPattern = (prefix: string) =>
  `${prefix.replace(/[\\%_]/g, '\\$&')}%`;

@Injectable()
export class VectorRepository implements OnModuleInit {
  private readonly logger = new Logger(VectorRepository.name);
  private pool: Pool;

  private ready = false;

  async onModuleInit(): Promise<void> {
    this.pool = new Pool({ connectionString: envs.DATABASE_URL });
    await this.ensureSchema();
  }

  async ensureSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await client.query(`
        CREATE TABLE IF NOT EXISTS ai_context_vectors (
          id           SERIAL PRIMARY KEY,
          text         TEXT NOT NULL,
          embedding    halfvec(${envs.EMBEDDING_DIM}),
          source       VARCHAR NOT NULL,
          category     VARCHAR NOT NULL,
          chunk_index  INTEGER DEFAULT 0,
          total_chunks INTEGER DEFAULT 1,
          created_at   TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_ai_vectors_source
          ON ai_context_vectors (source)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_ai_vectors_category
          ON ai_context_vectors (category)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_ai_vectors_source_fts
          ON ai_context_vectors USING GIN (to_tsvector('spanish', source))
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_ai_vectors_text_fts
          ON ai_context_vectors USING GIN (to_tsvector('spanish', text))
      `);
      this.ready = true;
      this.logger.log('Vector schema listo');
    } catch (err: any) {
      this.logger.error(
        `pgvector no disponible en esta instancia PostgreSQL: ${err?.message}. ` +
          `Instalá la extensión con: CREATE EXTENSION vector; (requiere superuser). ` +
          `El módulo AI funcionará sin indexación hasta que esté disponible.`,
      );
    } finally {
      client.release();
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async deleteBySource(source: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM ai_context_vectors WHERE source = $1', [
        source,
      ]);
    } finally {
      client.release();
    }
  }

  async insertChunk(opts: {
    text: string;
    embedding: number[];
    source: string;
    category: string;
    chunkIndex: number;
    totalChunks: number;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      const embStr = `ARRAY[${opts.embedding.join(',')}]::vector(${envs.EMBEDDING_DIM})::halfvec(${envs.EMBEDDING_DIM})`;
      await client.query(
        `INSERT INTO ai_context_vectors (text, embedding, source, category, chunk_index, total_chunks)
         VALUES ($1, ${embStr}, $2, $3, $4, $5)`,
        [
          opts.text,
          opts.source,
          opts.category,
          opts.chunkIndex,
          opts.totalChunks,
        ],
      );
    } finally {
      client.release();
    }
  }

  async insertChunks(
    chunks: Array<{
      text: string;
      embedding: number[];
      source: string;
      category: string;
      chunkIndex: number;
      totalChunks: number;
    }>,
  ): Promise<void> {
    if (chunks.length === 0) return;
    const client = await this.pool.connect();
    try {
      const SUB_BATCH = 30;
      for (let start = 0; start < chunks.length; start += SUB_BATCH) {
        const batch = chunks.slice(start, start + SUB_BATCH);
        const placeholders: string[] = [];
        const values: unknown[] = [];
        let idx = 1;
        for (const c of batch) {
          const embStr = `ARRAY[${c.embedding.join(',')}]::vector(${envs.EMBEDDING_DIM})::halfvec(${envs.EMBEDDING_DIM})`;
          placeholders.push(
            `($${idx}, ${embStr}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`,
          );
          values.push(
            c.text,
            c.source,
            c.category,
            c.chunkIndex,
            c.totalChunks,
          );
          idx += 5;
        }
        await client.query(
          `INSERT INTO ai_context_vectors (text, embedding, source, category, chunk_index, total_chunks)
           VALUES ${placeholders.join(', ')}`,
          values,
        );
      }
    } finally {
      client.release();
    }
  }

  async findSimilar(opts: {
    embedding: number[];
    k: number;
    categories?: string[];
    sources?: string[];
    /** Sources starting with any of these prefixes are left out. */
    excludeSourcePrefixes?: string[];
  }): Promise<VectorChunk[]> {
    const client = await this.pool.connect();
    try {
      const embStr = `ARRAY[${opts.embedding.join(',')}]::vector(${envs.EMBEDDING_DIM})::halfvec(${envs.EMBEDDING_DIM})`;
      const params: unknown[] = [opts.k];
      const filters: string[] = [];

      if (opts.categories && opts.categories.length > 0) {
        params.push(opts.categories);
        filters.push(`category = ANY($${params.length})`);
      }
      if (opts.sources && opts.sources.length > 0) {
        params.push(opts.sources);
        filters.push(`source = ANY($${params.length})`);
      }
      if (opts.excludeSourcePrefixes && opts.excludeSourcePrefixes.length > 0) {
        params.push(opts.excludeSourcePrefixes.map(prefixPattern));
        filters.push(`NOT (source LIKE ANY($${params.length}))`);
      }

      const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const result = await client.query(
        `SELECT text, source, category, (embedding <=> ${embStr}) AS distance
         FROM ai_context_vectors
         ${where}
         ORDER BY embedding <=> ${embStr}
         LIMIT $1`,
        params,
      );
      return result.rows.map((r: any) => ({
        text: r.text,
        source: r.source,
        category: r.category,
        distance: parseFloat(r.distance),
      }));
    } finally {
      client.release();
    }
  }

  async listSources(opts: {
    limit: number;
    offset: number;
    category?: string;
    search?: string;
    /** Sources starting with any of these prefixes are left out. */
    excludeSourcePrefixes?: string[];
  }): Promise<{ items: SourceItem[]; total: number }> {
    const client = await this.pool.connect();
    try {
      const params: unknown[] = [];
      const filters: string[] = [];
      const search = opts.search?.trim();

      if (opts.category) {
        params.push(opts.category);
        filters.push(`category = $${params.length}`);
      }
      if (opts.excludeSourcePrefixes && opts.excludeSourcePrefixes.length > 0) {
        params.push(opts.excludeSourcePrefixes.map(prefixPattern));
        filters.push(`NOT (source LIKE ANY($${params.length}))`);
      }

      let rankSelect = '0';
      if (search) {
        // Combine full-text search (relevance-ranked, source weighted above text)
        // with ILIKE (keeps recall for short/partial/typo-ish substrings that FTS misses).
        params.push(search);
        const tsIdx = params.length;
        params.push(`%${search.replace(/[!%_]/g, '!$&')}%`);
        const likeIdx = params.length;

        filters.push(`(
          to_tsvector('spanish', source) @@ websearch_to_tsquery('spanish', $${tsIdx})
          OR to_tsvector('spanish', text) @@ websearch_to_tsquery('spanish', $${tsIdx})
          OR source ILIKE $${likeIdx} ESCAPE '!'
          OR text ILIKE $${likeIdx} ESCAPE '!'
        )`);

        rankSelect = `(
          setweight(to_tsvector('spanish', source), 'A') ||
          setweight(to_tsvector('spanish', text), 'B')
        ), websearch_to_tsquery('spanish', $${tsIdx})`;
        rankSelect = `ts_rank(${rankSelect})`;
      }

      const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

      const countResult = await client.query(
        `SELECT COUNT(DISTINCT source) AS total FROM ai_context_vectors ${where}`,
        params,
      );
      const total = parseInt(countResult.rows[0].total, 10);

      params.push(opts.limit);
      const limitIdx = params.length;
      params.push(opts.offset);
      const offsetIdx = params.length;

      // When searching, dedupe to the best-ranked chunk per source, then order
      // the resulting one-row-per-source set by that relevance rank.
      // Without a search term, preserve the original insertion-order behavior.
      const result = search
        ? await client.query(
            `SELECT source, category, summary FROM (
               SELECT DISTINCT ON (source)
                 source, category, LEFT(text, 200) AS summary, ${rankSelect} AS rank
               FROM ai_context_vectors
               ${where}
               ORDER BY source, rank DESC, chunk_index
             ) ranked_sources
             ORDER BY rank DESC, source
             LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
            params,
          )
        : await client.query(
            `SELECT DISTINCT ON (source) source, category, LEFT(text, 200) AS summary
             FROM ai_context_vectors
             ${where}
             ORDER BY source, chunk_index
             LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
            params,
          );

      return {
        items: result.rows.map((r: any) => ({
          source: r.source,
          category: r.category,
          summary: r.summary ?? '',
        })),
        total,
      };
    } finally {
      client.release();
    }
  }

  /** The first `chunksPerSource` chunks of each source, in chunk order. */
  async findTextBySources(
    sources: string[],
    chunksPerSource = 3,
  ): Promise<Array<{ source: string; category: string; text: string }>> {
    if (sources.length === 0) return [];
    const client = await this.pool.connect();
    try {
      const result = await client.query<{
        source: string;
        category: string;
        text: string;
      }>(
        `SELECT source, category, text FROM (
           SELECT source, category, text, chunk_index,
                  row_number() OVER (PARTITION BY source ORDER BY chunk_index) AS n
           FROM ai_context_vectors
           WHERE source = ANY($1)
         ) chunks
         WHERE n <= $2
         ORDER BY source, chunk_index`,
        [sources, chunksPerSource],
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  /** The subset of `sources` that have at least one vector. */
  async existingSources(sources: string[]): Promise<Set<string>> {
    if (sources.length === 0) return new Set();
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ source: string }>(
        'SELECT DISTINCT source FROM ai_context_vectors WHERE source = ANY($1)',
        [sources],
      );
      return new Set(result.rows.map((r) => r.source));
    } finally {
      client.release();
    }
  }

  async countAll(): Promise<number> {
    if (!this.ready) return -1;
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT COUNT(*) AS total FROM ai_context_vectors',
      );
      return parseInt(result.rows[0].total, 10);
    } finally {
      client.release();
    }
  }

  async countByCategory(): Promise<
    Array<{ category: string; chunks: number; sources: number }>
  > {
    if (!this.ready) return [];
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT category,
                COUNT(*)::int AS chunks,
                COUNT(DISTINCT source)::int AS sources
         FROM ai_context_vectors
         GROUP BY category
         ORDER BY category`,
      );
      return result.rows.map((row: any) => ({
        category: row.category,
        chunks: Number(row.chunks),
        sources: Number(row.sources),
      }));
    } finally {
      client.release();
    }
  }

  /** Runs `fn` with a dedicated pooled client (e.g. for a transaction). */
  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async getSizeReport(): Promise<VectorSizeReport> {
    return this.withClient(async (client) => {
      const result = await client.query<{
        total_bytes: string;
        table_bytes: string;
        toast_bytes: string;
        index_bytes: string;
        avg_embedding_bytes: string | null;
      }>(
        `SELECT pg_total_relation_size(c.oid) AS total_bytes,
                pg_relation_size(c.oid) AS table_bytes,
                CASE WHEN c.reltoastrelid = 0 THEN 0
                     ELSE pg_total_relation_size(c.reltoastrelid) END AS toast_bytes,
                pg_indexes_size(c.oid) AS index_bytes,
                (SELECT AVG(pg_column_size(embedding))::bigint
                   FROM ai_context_vectors TABLESAMPLE SYSTEM (1)) AS avg_embedding_bytes
         FROM pg_class c
         WHERE c.oid = 'ai_context_vectors'::regclass`,
      );
      const row = result.rows[0];
      return {
        totalBytes: Number(row.total_bytes),
        tableBytes: Number(row.table_bytes),
        toastBytes: Number(row.toast_bytes),
        indexBytes: Number(row.index_bytes),
        avgEmbeddingBytes:
          row.avg_embedding_bytes === null
            ? null
            : Number(row.avg_embedding_bytes),
      };
    });
  }
}
