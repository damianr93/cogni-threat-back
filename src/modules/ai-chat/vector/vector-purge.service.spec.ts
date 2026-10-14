import { BadRequestException, ConflictException } from '@nestjs/common';
import { VectorPurgeService } from './vector-purge.service';

const mockEnvs = {
  RAG_CVE_EMBED_MODE: 'kev',
  RAG_RANSOMWARE_VICTIM_EMBED_MODE: 'none',
  RAG_TELEGRAM_EMBED_MODE: 'none',
};

jest.mock('libs/config/src/envs', () => ({
  get envs() {
    return mockEnvs;
  },
}));

const SIZES = {
  totalBytes: 1000,
  tableBytes: 100,
  toastBytes: 600,
  indexBytes: 300,
  avgEmbeddingBytes: 8192,
};

interface ClientOpts {
  locked?: boolean;
  hasRows?: boolean;
  failOn?: RegExp;
}

function build(opts: ClientOpts = {}) {
  const { locked = true, hasRows = true, failOn } = opts;
  const sql: string[] = [];
  const client = {
    query: jest.fn((text: string) => {
      sql.push(text);
      if (failOn?.test(text)) return Promise.reject(new Error('boom'));
      if (/pg_try_advisory_xact_lock/.test(text)) {
        return Promise.resolve({ rows: [{ locked }] });
      }
      if (/EXISTS/.test(text)) {
        return Promise.resolve({ rows: [{ has_rows: hasRows }] });
      }
      return Promise.resolve({ rows: [] });
    }),
  };
  const vectors = {
    getSizeReport: jest
      .fn()
      .mockResolvedValueOnce(SIZES)
      .mockResolvedValue({ ...SIZES, totalBytes: 10 }),
    countByCategory: jest
      .fn()
      .mockResolvedValue([{ category: 'cve', chunks: 3, sources: 2 }]),
    countAll: jest.fn().mockResolvedValue(3),
    withClient: jest.fn((fn: (c: typeof client) => Promise<unknown>) =>
      fn(client),
    ),
  };
  const ingestion = { isRunning: jest.fn().mockReturnValue(false) };
  let manualPaused = false;
  const control = {
    getStatus: jest.fn(() => ({ manualPaused })),
    pauseManual: jest.fn(() => {
      manualPaused = true;
    }),
    resumeManual: jest.fn(() => {
      manualPaused = false;
    }),
  };
  const service = new VectorPurgeService(
    vectors as never,
    ingestion as never,
    control as never,
  );
  return {
    service,
    vectors,
    ingestion,
    control,
    client,
    sql,
    paused: () => manualPaused,
  };
}

function setScope(cve: string, victims: string, telegram: string) {
  mockEnvs.RAG_CVE_EMBED_MODE = cve;
  mockEnvs.RAG_RANSOMWARE_VICTIM_EMBED_MODE = victims;
  mockEnvs.RAG_TELEGRAM_EMBED_MODE = telegram;
}

describe('VectorPurgeService', () => {
  beforeEach(() => setScope('kev', 'none', 'none'));

  describe('getReport', () => {
    it('returns sizes, categories, scope and wouldRefuse without writing', async () => {
      const { service, client, control } = build();

      const report = await service.getReport();

      expect(report).toEqual({
        sizes: SIZES,
        categories: [{ category: 'cve', chunks: 3, sources: 2 }],
        scope: { cve: 'kev', victims: 'none', telegram: 'none' },
        scopeReduced: true,
        wouldRefuse: null,
      });
      expect(client.query).not.toHaveBeenCalled();
      expect(control.pauseManual).not.toHaveBeenCalled();
    });

    it.each([
      ['all', 'none', 'none'],
      ['kev', 'all', 'none'],
      ['kev', 'none', 'all'],
    ])(
      'wouldRefuse is scope_not_reduced for %s/%s/%s, matching purge',
      async (cve, victims, telegram) => {
        setScope(cve, victims, telegram);
        const { service } = build();

        const report = await service.getReport();

        expect(report.scopeReduced).toBe(false);
        expect(report.wouldRefuse).toBe('scope_not_reduced');
        await expect(service.purge({ confirm: true })).rejects.toMatchObject({
          response: { code: 'scope_not_reduced' },
        });
      },
    );
  });

  describe('purge guards', () => {
    it.each([undefined, false])('rejects confirm=%s with no SQL', async (c) => {
      const { service, vectors, control } = build();

      await expect(service.purge({ confirm: c })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(vectors.withClient).not.toHaveBeenCalled();
      expect(control.pauseManual).not.toHaveBeenCalled();
    });

    it.each([
      ['all', 'none', 'none'],
      ['kev', 'all', 'none'],
      ['kev', 'none', 'all'],
    ])(
      'refuses %s/%s/%s with 409 and no SQL or pause',
      async (cve, victims, telegram) => {
        setScope(cve, victims, telegram);
        const { service, vectors, control } = build();

        const err = await service.purge({ confirm: true }).catch((e) => e);

        expect(err).toBeInstanceOf(ConflictException);
        expect(err.getResponse()).toEqual({
          code: 'scope_not_reduced',
          scope: { cve, victims, telegram },
        });
        expect(vectors.withClient).not.toHaveBeenCalled();
        expect(control.pauseManual).not.toHaveBeenCalled();
      },
    );

    it('force bypasses the scope check', async () => {
      setScope('all', 'all', 'all');
      const { service } = build();

      const result = await service.purge({ confirm: true, force: true });

      expect(result.status).toBe('purged');
    });

    it('returns 409 while ingestion is running', async () => {
      const { service, ingestion, vectors, control } = build();
      ingestion.isRunning.mockReturnValue(true);

      await expect(service.purge({ confirm: true })).rejects.toMatchObject({
        response: { code: 'ingestion_running' },
      });
      expect(vectors.withClient).not.toHaveBeenCalled();
      expect(control.pauseManual).not.toHaveBeenCalled();
    });

    it('returns 409 and rolls back when the advisory lock is held', async () => {
      const { service, sql, paused } = build({ locked: false });

      await expect(service.purge({ confirm: true })).rejects.toMatchObject({
        response: { code: 'purge_in_progress' },
      });
      expect(sql).toEqual([
        'BEGIN',
        expect.stringContaining('pg_try_advisory_xact_lock'),
        'ROLLBACK',
      ]);
      expect(paused()).toBe(false);
    });
  });

  describe('confirmed purge', () => {
    it('runs lock, lock_timeout, EXISTS, TRUNCATE, sync reset in one transaction', async () => {
      const { service, sql, control } = build();

      const result = await service.purge({ confirm: true });

      expect(sql).toEqual([
        'BEGIN',
        expect.stringContaining('pg_try_advisory_xact_lock'),
        expect.stringContaining('lock_timeout'),
        expect.stringContaining('EXISTS'),
        'TRUNCATE ai_context_vectors',
        'DELETE FROM ai_sync_states',
        'COMMIT',
      ]);
      expect(result).toEqual({
        status: 'purged',
        removedRows: 3,
        beforeBytes: 1000,
        afterBytes: 10,
      });
      expect(control.pauseManual).toHaveBeenCalledTimes(1);
      expect(control.resumeManual).toHaveBeenCalledTimes(1);
    });

    it('is a noop on an empty table but still resets watermarks', async () => {
      const { service, sql } = build({ hasRows: false });

      const result = await service.purge({ confirm: true });

      expect(result.status).toBe('noop');
      expect(sql).not.toContain('TRUNCATE ai_context_vectors');
      expect(sql).toContain('DELETE FROM ai_sync_states');
      expect(sql[sql.length - 1]).toBe('COMMIT');
    });

    it('rolls back on failure and restores a previously running sync', async () => {
      const { service, sql, paused } = build({ failOn: /^TRUNCATE/ });

      await expect(service.purge({ confirm: true })).rejects.toThrow('boom');

      expect(sql).not.toContain('DELETE FROM ai_sync_states');
      expect(sql[sql.length - 1]).toBe('ROLLBACK');
      expect(paused()).toBe(false);
    });

    it('keeps sync paused when it was already manually paused', async () => {
      const { service, control, paused } = build({ failOn: /^TRUNCATE/ });
      control.pauseManual();
      control.pauseManual.mockClear();

      await expect(service.purge({ confirm: true })).rejects.toThrow();

      expect(control.resumeManual).not.toHaveBeenCalled();
      expect(paused()).toBe(true);
    });
  });
});
