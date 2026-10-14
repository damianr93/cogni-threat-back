export type ToolResult = Record<string, unknown>;

/** Bounds of the per-result character cap (sized for an 8k-token context). */
export const MIN_RESULT_CHARS = 600;
export const MAX_RESULT_CHARS = 2500;

export function clampResultCap(cap: number): number {
  if (!Number.isFinite(cap)) return MAX_RESULT_CHARS;
  return Math.max(
    MIN_RESULT_CHARS,
    Math.min(MAX_RESULT_CHARS, Math.floor(cap)),
  );
}

const sizeOf = (value: unknown): number => JSON.stringify(value).length;

/**
 * Keeps a tool result under the clamped cap by popping trailing `items`, so the
 * model always receives valid JSON and is told the list was cut
 * (`truncated: true`). Results that cannot be shrunk become an `{ error }`.
 */
export function fitResult(
  result: ToolResult,
  cap: number = MAX_RESULT_CHARS,
): ToolResult {
  const limit = clampResultCap(cap);
  if (sizeOf(result) <= limit) return result;

  const tooLarge: ToolResult = {
    error: 'Result too large; narrow the query with more specific filters.',
  };
  if (!Array.isArray(result.items)) return tooLarge;

  const items: unknown[] = [...(result.items as unknown[])];
  let fitted: ToolResult = { ...result, items, truncated: true };
  while (items.length > 0 && sizeOf(fitted) > limit) {
    items.pop();
    fitted = { ...result, items: [...items], truncated: true };
  }
  return sizeOf(fitted) > limit ? tooLarge : fitted;
}
