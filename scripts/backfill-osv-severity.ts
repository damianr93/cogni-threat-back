/**
 * Backfills severity and CVSS data for OSV rows that were ingested without it.
 * Run: pnpm backfill:osv-severity [--dry-run] [--batch=2000]
 *
 * The logic lives in src/modules/vuln-monitor/utils/osv-severity-backfill.ts so
 * it is covered by Jest; this file only parses arguments and wires Prisma.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  parseBackfillArgs,
  runOsvSeverityBackfill,
} from '../src/modules/vuln-monitor/utils/osv-severity-backfill';

async function main() {
  const options = parseBackfillArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    await runOsvSeverityBackfill(prisma, { ...options, log: console.log });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
