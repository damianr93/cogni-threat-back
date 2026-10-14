import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/** Migrations at or before this one predate the AI search objects guard. */
const BASELINE = '20260708163042_risk_operations';
const MIGRATIONS_DIR = join(__dirname, 'migrations');

const FORBIDDEN: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'drops ai_context_vectors',
    pattern:
      /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?("?public"?\.)?"?ai_context_vectors"?/i,
  },
  {
    label: 'drops telegram_msg_fts_* index',
    pattern:
      /DROP\s+INDEX\s+(IF\s+EXISTS\s+)?([\w".]+,\s*)*("?public"?\.)?"?telegram_msg_fts_/i,
  },
];

export function findForbiddenStatements(sql: string): string[] {
  return FORBIDDEN.filter((rule) => rule.pattern.test(sql)).map((r) => r.label);
}

export function scanMigrations(dir: string, baseline: string): string[] {
  const violations: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name <= baseline || !/^\d{14}_/.test(name)) continue;
    const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
    for (const label of findForbiddenStatements(sql)) {
      violations.push(`${name}: ${label}`);
    }
  }
  return violations;
}

describe('migrations guard', () => {
  describe('findForbiddenStatements', () => {
    it('flags DROP TABLE "ai_context_vectors"', () => {
      expect(
        findForbiddenStatements(
          '-- DropTable\nDROP TABLE "ai_context_vectors";',
        ),
      ).toEqual(['drops ai_context_vectors']);
    });

    it('flags DROP INDEX on a telegram_msg_fts_* index', () => {
      expect(
        findForbiddenStatements('DROP INDEX "telegram_msg_fts_spanish_idx";'),
      ).toEqual(['drops telegram_msg_fts_* index']);
      expect(
        findForbiddenStatements(
          'DROP INDEX IF EXISTS telegram_msg_fts_simple_idx;',
        ),
      ).toEqual(['drops telegram_msg_fts_* index']);
    });

    it('allows unrelated drops and creates', () => {
      expect(
        findForbiddenStatements(
          'DROP INDEX "other_idx";\nDROP TABLE "foo";\nCREATE INDEX IF NOT EXISTS telegram_msg_fts_simple_idx ON t (c);',
        ),
      ).toEqual([]);
    });
  });

  describe('scanMigrations (fixtures)', () => {
    let dir: string;
    const write = (name: string, sql: string) => {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, 'migration.sql'), sql);
    };

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'mig-guard-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('fails for a newer migration that drops ai_context_vectors', () => {
      write(BASELINE, 'DROP TABLE "ai_context_vectors";');
      write('20260801000000_bad', 'DROP TABLE "ai_context_vectors";');
      expect(scanMigrations(dir, BASELINE)).toEqual([
        '20260801000000_bad: drops ai_context_vectors',
      ]);
    });

    it('fails for a newer migration that drops telegram_msg_fts_*', () => {
      write('20260801000000_bad', 'DROP INDEX "telegram_msg_fts_simple_idx";');
      expect(scanMigrations(dir, BASELINE)).toEqual([
        '20260801000000_bad: drops telegram_msg_fts_* index',
      ]);
    });

    it('ignores the baseline and older migrations and clean newer ones', () => {
      write('20260101000000_old', 'DROP TABLE "ai_context_vectors";');
      write(BASELINE, 'DROP TABLE "ai_context_vectors";');
      write('20260801000000_ok', 'CREATE INDEX x ON y (z);');
      expect(scanMigrations(dir, BASELINE)).toEqual([]);
    });
  });

  it('no migration newer than the baseline drops AI search objects', () => {
    expect(scanMigrations(MIGRATIONS_DIR, BASELINE)).toEqual([]);
  });
});
