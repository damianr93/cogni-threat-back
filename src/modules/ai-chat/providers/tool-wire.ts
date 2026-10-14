import { LlmMessage, ToolCall, ToolDefinition } from '../types/chat.types';

/** Ollama /api/chat tool shape. */
export interface WireTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface WireToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
}

const TOOL_TAG = /<\/?tool_(call|result)[^>]*>/g;

export function toWireTools(tools?: ToolDefinition[]): WireTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Ollama returns `arguments` as an object while OpenAI-style backends send a
 * JSON string; unparseable strings are kept under `raw` instead of dropping the call.
 */
export function toToolCalls(wire?: WireToolCall[]): ToolCall[] | undefined {
  if (!Array.isArray(wire) || wire.length === 0) return undefined;
  const calls: ToolCall[] = [];
  for (const raw of wire) {
    const name = raw?.function?.name;
    if (!name) continue;
    let args: Record<string, unknown> = {};
    const rawArgs = raw.function?.arguments;
    if (typeof rawArgs === 'string') {
      try {
        const parsed: unknown = JSON.parse(rawArgs);
        args =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { raw: rawArgs };
      } catch {
        args = { raw: rawArgs };
      }
    } else if (rawArgs && typeof rawArgs === 'object') {
      args = rawArgs;
    }
    calls.push({ name, arguments: args });
  }
  return calls.length > 0 ? calls : undefined;
}

/**
 * Role-neutral re-feed of a model tool call: some Ollama chat templates mishandle
 * `role: tool`, so the call travels as plain assistant text.
 */
export function toToolCallMessage(call: ToolCall): LlmMessage {
  return {
    role: 'assistant',
    content: `<tool_call name="${call.name}">${JSON.stringify(call.arguments)}</tool_call>`,
  };
}

export function toToolResultMessage(name: string, result: unknown): LlmMessage {
  return {
    role: 'user',
    content: `<tool_result name="${name}">${JSON.stringify(result)}</tool_result>`,
  };
}

/** Removes the wire tags so they never reach the user. */
export function stripToolTags(text: string | null | undefined): string {
  return (text ?? '').replace(TOOL_TAG, '').trim();
}
