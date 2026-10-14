import { LlmMessage, ToolDefinition } from '../types/chat.types';
import { clampResultCap } from '../tools/fit-result';

/** Tokens held back for the model's answer. */
export const ANSWER_RESERVE_TOKENS = 1024;
/** Below this many spare tokens another tool round is not worth it. */
export const MIN_ROUND_TOKENS = 900;

const CHARS_PER_TOKEN = 3;
const MESSAGE_OVERHEAD_TOKENS = 4;
const RESULT_SHARE = 0.6;
/** Share of the spare prompt room a prefetched context block may take. */
const PREFETCH_SHARE = 0.5;
const TOOL_RESULT_OPEN = /^<tool_result name="([^"]*)">/;

/** The fixed part of the prompt (system prompt or tool schemas) cannot fit `num_ctx`. */
export class ContextBudgetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextBudgetConfigError';
  }
}

export interface FitOptions {
  numCtx: number;
  /** Maximum characters kept from the user question as a last resort. */
  queryMaxChars: number;
  /** Index of the current question; everything before it (after the system prompt) is history. */
  turnStart: number;
}

export interface FitOutcome {
  messages: LlmMessage[];
  /** `undefined` when closure is forced: the model must answer in text. */
  tools: ToolDefinition[] | undefined;
  forceClosure: boolean;
  /** Character cap for each tool result of the next round. */
  resultCap: number;
}

const tokensOf = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

export function estimateTokens(
  messages: LlmMessage[],
  tools?: ToolDefinition[],
): number {
  const toolChars = tools?.length ? JSON.stringify(tools).length : 0;
  return messages.reduce(
    (sum, m) => sum + tokensOf(m.content.length) + MESSAGE_OVERHEAD_TOKENS,
    tokensOf(toolChars),
  );
}

const omittedBody = (content: string): string | undefined => {
  const name = TOOL_RESULT_OPEN.exec(content)?.[1];
  return name === undefined
    ? undefined
    : `<tool_result name="${name}">{"omitted":"context_budget"}</tool_result>`;
};

/**
 * Pure context guard for one provider call. The system prompt (index 0) and the
 * tool schemas are never trimmed; only history and tool results are. Trim order:
 * oldest history, oldest tool results, forced tool-less closure, question cut.
 */
export function fitContext(
  input: LlmMessage[],
  tools: ToolDefinition[] | undefined,
  { numCtx, queryMaxChars, turnStart }: FitOptions,
): FitOutcome {
  const available = numCtx - ANSWER_RESERVE_TOKENS;
  const fixed = estimateTokens([input[0]], tools);
  if (fixed > available) {
    throw new ContextBudgetConfigError(
      `System prompt and tool schemas need ~${fixed} tokens but only ${available} fit num_ctx=${numCtx}; raise RAG_CHAT_NUM_CTX or shrink the tool schemas`,
    );
  }

  let messages = [...input];
  let offered = tools;
  let start = turnStart;
  const used = () => estimateTokens(messages, offered);
  // While tools are on offer, trim until another round still fits; trimming
  // only to `available` would leave too little room and force closure anyway.
  const target = offered ? available - MIN_ROUND_TOKENS : available;

  while (used() > target && start > 1) {
    messages.splice(1, 1);
    start -= 1;
  }

  for (let i = start + 1; i < messages.length && used() > target; i++) {
    const body = omittedBody(messages[i].content);
    if (body !== undefined && body !== messages[i].content) {
      messages = messages.map((m, j) =>
        j === i ? { ...m, content: body } : m,
      );
    }
  }

  let forceClosure = false;
  if (used() > available) {
    forceClosure = true;
    offered = undefined;
  }
  if (used() > available) {
    const question = messages[start];
    messages = messages.map((m, j) =>
      j === start
        ? { ...question, content: question.content.slice(0, queryMaxChars) }
        : m,
    );
  }

  let remaining = available - used();
  if (!forceClosure && remaining < MIN_ROUND_TOKENS) {
    forceClosure = true;
    offered = undefined;
    remaining = available - used();
  }

  return {
    messages,
    tools: offered,
    forceClosure,
    resultCap: clampResultCap(
      Math.floor(remaining * CHARS_PER_TOKEN * RESULT_SHARE),
    ),
  };
}

/**
 * Characters a prefetched context block may add to the current turn. It keeps
 * the answer reserve and one more tool round free, and leaves half of what
 * remains for the tool results, so `fitContext` never has to trim the block.
 */
export function prefetchBudgetChars(
  messages: LlmMessage[],
  tools: ToolDefinition[] | undefined,
  numCtx: number,
): number {
  const spare =
    numCtx -
    ANSWER_RESERVE_TOKENS -
    MIN_ROUND_TOKENS -
    estimateTokens(messages, tools);
  return Math.max(0, Math.floor(spare * CHARS_PER_TOKEN * PREFETCH_SHARE));
}
