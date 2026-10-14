import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { envs } from 'libs/config/src/envs';
import { EmbeddingSyncControlService } from '../ingestion/embedding-sync-control.service';
import { EmbedScope, resolveEmbedScope } from '../ingestion/embed-scope';
import { IngestionService } from '../ingestion/ingestion.service';
import { VectorRepository, VectorSizeReport } from './vector.repository';

export type PurgeRefusal = 'scope_not_reduced';

export interface PurgeReport {
  sizes: VectorSizeReport;
  categories: Array<{ category: string; chunks: number; sources: number }>;
  scope: EmbedScope;
  scopeReduced: boolean;
  wouldRefuse: PurgeRefusal | null;
}

export interface PurgeResult {
  status: 'purged' | 'noop';
  removedRows: number;
  beforeBytes: number;
  afterBytes: number;
}

const PURGE_LOCK = `SELECT pg_try_advisory_xact_lock(hashtext('ai_context_vectors:purge')) AS locked`;

/**
 * Empties `ai_context_vectors` and resets every sync watermark so the next
 * ingestion re-embeds only the in-scope sources. Admin-triggered only: it is
 * never invoked on startup or from a migration.
 */
@Injectable()
export class VectorPurgeService {
  private readonly logger = new Logger(VectorPurgeService.name);

  constructor(
    private readonly vectors: VectorRepository,
    private readonly ingestion: IngestionService,
    private readonly syncControl: EmbeddingSyncControlService,
  ) {}

  /** Read-only: nothing here writes or changes the pause state. */
  async getReport(): Promise<PurgeReport> {
    const [sizes, categories] = await Promise.all([
      this.vectors.getSizeReport(),
      this.vectors.countByCategory(),
    ]);
    const { scope, scopeReduced } = this.currentScope();
    return {
      sizes,
      categories,
      scope,
      scopeReduced,
      wouldRefuse: scopeReduced ? null : 'scope_not_reduced',
    };
  }

  async purge(opts: {
    confirm?: boolean;
    force?: boolean;
  }): Promise<PurgeResult> {
    if (opts.confirm !== true) {
      throw new BadRequestException({ code: 'confirm_required' });
    }
    const { scope, scopeReduced } = this.currentScope();
    if (!scopeReduced && opts.force !== true) {
      throw new ConflictException({ code: 'scope_not_reduced', scope });
    }
    if (this.ingestion.isRunning()) {
      throw new ConflictException({ code: 'ingestion_running' });
    }

    const wasManuallyPaused = this.syncControl.getStatus().manualPaused;
    this.syncControl.pauseManual();
    try {
      const before = await this.vectors.getSizeReport();
      const rows = await this.vectors.countAll();
      const hadRows = await this.truncateInTransaction();
      const after = await this.vectors.getSizeReport();
      this.logger.warn(
        `Vector purge ${hadRows ? 'purged' : 'noop'}: ${hadRows ? rows : 0} rows removed`,
      );
      return {
        status: hadRows ? 'purged' : 'noop',
        removedRows: hadRows ? Math.max(rows, 0) : 0,
        beforeBytes: before.totalBytes,
        afterBytes: after.totalBytes,
      };
    } finally {
      if (!wasManuallyPaused) this.syncControl.resumeManual();
    }
  }

  private currentScope(): { scope: EmbedScope; scopeReduced: boolean } {
    const scope = resolveEmbedScope(envs);
    return {
      scope,
      scopeReduced:
        scope.cve !== 'all' &&
        scope.victims === 'none' &&
        scope.telegram === 'none',
    };
  }

  /** Returns whether the table had rows. Rolls back on any failure. */
  private truncateInTransaction(): Promise<boolean> {
    return this.vectors.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const lock = await client.query<{ locked: boolean }>(PURGE_LOCK);
        if (!lock.rows[0]?.locked) {
          throw new ConflictException({ code: 'purge_in_progress' });
        }
        await client.query(`SET LOCAL lock_timeout = '10s'`);
        const exists = await client.query<{ has_rows: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM ai_context_vectors) AS has_rows',
        );
        const hasRows = exists.rows[0]?.has_rows === true;
        if (hasRows) await client.query('TRUNCATE ai_context_vectors');
        await client.query('DELETE FROM ai_sync_states');
        await client.query('COMMIT');
        return hasRows;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  }
}
