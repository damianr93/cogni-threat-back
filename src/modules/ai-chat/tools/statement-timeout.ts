import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';

/** SQLSTATE raised by Postgres when a statement exceeds `statement_timeout`. */
const QUERY_CANCELED = '57014';
/** Extra time the interactive transaction gets beyond the statement timeout. */
const TRANSACTION_HEADROOM_MS = 2000;

function isStatementTimeout(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { message, meta } = err as {
    message?: unknown;
    meta?: { code?: unknown };
  };
  return (
    meta?.code === QUERY_CANCELED ||
    (typeof message === 'string' && /statement timeout/i.test(message))
  );
}

/**
 * Runs `work` inside a transaction whose `statement_timeout` is applied with
 * `SET LOCAL`, so it ends with the transaction and never leaks to the pooled
 * connection. A timeout resolves to `{ error }` for the model; any other
 * failure is rethrown.
 */
export async function withStatementTimeout<T>(
  prisma: Pick<PrismaService, '$transaction'>,
  timeoutMs: number,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | { error: string }> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('statement timeout must be a positive integer (ms)');
  }
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Integer-validated above: SET LOCAL does not accept bind parameters.
        await tx.$executeRawUnsafe(
          `SET LOCAL statement_timeout = ${timeoutMs}`,
        );
        return work(tx);
      },
      { timeout: timeoutMs + TRANSACTION_HEADROOM_MS },
    );
  } catch (err: unknown) {
    if (isStatementTimeout(err)) {
      return {
        error: `Query timed out after ${timeoutMs} ms; narrow the query with more specific filters.`,
      };
    }
    throw err;
  }
}
