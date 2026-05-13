import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { envs } from 'libs/config/src/envs';

export interface VectorChunk {
  text: string;
  source: string;
  category: string;
  distance: number;
}

export interface SourceItem {
  source: string;
  category: string;
  summary: string;
}

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
      await client.query('DELETE FROM ai_context_vectors WHERE source = $1', [source]);
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
        [opts.text, opts.source, opts.category, opts.chunkIndex, opts.totalChunks],
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
          placeholders.push(`($${idx}, ${embStr}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`);
          values.push(c.text, c.source, c.category, c.chunkIndex, c.totalChunks);
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
  }): Promise<{ items: SourceItem[]; total: number }> {
    const client = await this.pool.connect();
    try {
      const params: unknown[] = [];
      const filters: string[] = [];

      if (opts.category) {
        params.push(opts.category);
        filters.push(`category = $${params.length}`);
      }
      if (opts.search?.trim()) {
        params.push(`%${opts.search.trim()}%`);
        const i = params.length;
        filters.push(`(source ILIKE $${i} OR text ILIKE $${i})`);
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

      const result = await client.query(
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

  async countAll(): Promise<number> {
    if (!this.ready) return -1;
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT COUNT(*) AS total FROM ai_context_vectors');
      return parseInt(result.rows[0].total, 10);
    } finally {
      client.release();
    }
  }
}
