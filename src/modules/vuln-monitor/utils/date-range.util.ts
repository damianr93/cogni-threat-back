export const NVD_MAX_WINDOW_DAYS = 90;

export interface DateRangeChunk {
  start: Date;
  end: Date;
}

export function splitDateRange(
  start: Date,
  end: Date,
  maxDays = NVD_MAX_WINDOW_DAYS,
): DateRangeChunk[] {
  if (start.getTime() >= end.getTime()) {
    throw new Error('start must be before end');
  }

  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  const chunks: DateRangeChunk[] = [];
  let cursor = new Date(start);

  while (cursor.getTime() < end.getTime()) {
    const chunkEnd = new Date(
      Math.min(cursor.getTime() + maxMs, end.getTime()),
    );
    chunks.push({ start: new Date(cursor), end: chunkEnd });
    if (chunkEnd.getTime() >= end.getTime()) break;
    cursor = new Date(chunkEnd.getTime() + 1);
  }

  return chunks;
}
