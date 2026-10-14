import { z } from 'zod';
import { ToolContext } from '../rag/chat-orchestrator';
import { ToolResult } from './fit-result';

/** Hard cap on rows any tool may query or return. */
export const MAX_TOOL_LIMIT = 25;

/** Injection token: the concrete `ChatTool[]` the registry exposes. */
export const CHAT_TOOLS = Symbol('CHAT_TOOLS');

/**
 * Integer `limit` argument: defaults when absent, clamped to 1..max, and
 * non-numeric input (e.g. "abc") fails validation instead of reaching a query.
 */
export const limitOf = (def = 10, max = MAX_TOOL_LIMIT) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? def : Number(v)),
    z
      .number()
      .finite()
      .transform((n) => Math.max(1, Math.min(max, Math.floor(n)))),
  );

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/**
 * A read-only, parameterised tool. `schema` (zod) is the source of truth for
 * validation; `parameters` is the hand-written JSON schema sent to the model
 * (kept in sync by `jsonSchemaMismatches` in each tool's spec).
 */
export interface ChatTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  /** English, at most 200 characters. */
  description: string;
  parameters: JsonSchemaObject;
  schema: S;
  /** Receives the validated, clamped arguments. */
  run(args: z.infer<S>, context: ToolContext): Promise<ToolResult>;
}

/** Keeps `run` typed against its own schema, then erases the type for the registry. */
export function defineTool<S extends z.ZodTypeAny>(
  tool: ChatTool<S>,
): ChatTool {
  return tool;
}
