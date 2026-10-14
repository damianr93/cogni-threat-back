import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiConfigService } from '../ai-config.service';
import { fitContext, prefetchBudgetChars } from './context-budget';
import { SourcePrefetcher } from './source-prefetch';
import { detectIntents } from './router-intents';
import { OllamaChatProvider } from '../providers/ollama-chat.provider';
import {
  stripToolTags,
  toToolCallMessage,
  toToolResultMessage,
} from '../providers/tool-wire';
import { LlmMessage, ToolCall, ToolDefinition } from '../types/chat.types';

const MAX_HISTORY = 6;

/** Room taken by the CONTEXTO/PREGUNTA frame around a prefetched block. */
const PREFETCH_FRAME_CHARS = 120;
/** Below this a prefetched block is not worth the prompt space. */
const MIN_PREFETCH_CHARS = 500;
const PREFETCH_HEADER = 'CONTEXTO (fuentes seleccionadas por el usuario):';

const FORCE_CLOSURE_PROMPT =
  'Ya no puedes usar más herramientas. Responde ahora la pregunta original usando solo los resultados obtenidos; ' +
  'si no alcanzan, indica qué información falta.';

export const NO_ANSWER_MESSAGE =
  'No pude generar una respuesta con los datos disponibles. Intenta reformular la pregunta.';

/**
 * The model answered a data question without calling any tool at step 1; the
 * caller should route the question through the deterministic ChatRouter.
 */
export class NoToolCallsError extends Error {
  constructor() {
    super('Model returned no tool call for a data question');
    this.name = 'NoToolCallsError';
  }
}

/** Injection token for the tool registry the orchestrator drives. */
export const TOOL_EXECUTOR = Symbol('TOOL_EXECUTOR');

/** UI scope forwarded to tools that honour it (categories and selected sources). */
export interface ToolContext {
  categories?: string[];
  sources?: string[];
  /** Per-result character cap for this turn (clamped by `fitResult`). */
  maxResultChars?: number;
}

/**
 * Contract between the orchestrator and the tool registry. Implementations MUST
 * resolve to `{ error }` for unknown tools or invalid arguments instead of throwing.
 */
export interface ToolExecutor {
  readonly definitions: ToolDefinition[];
  execute(call: ToolCall, context: ToolContext): Promise<unknown>;
}

export interface OrchestratorInput {
  question: string;
  history: Array<{ role: string; content: string }>;
  categories?: string[];
  sources?: string[];
}

export interface OrchestratorResult {
  content: string;
  toolSteps: number;
  forcedClosure: boolean;
  toolsUsed: string[];
}

function buildSystemPrompt(today: string): string {
  return `Eres el asistente de inteligencia de amenazas de Cogni. Hoy es ${today}.
Dispones de herramientas de solo lectura sobre la base de datos de Cogni. Úsalas cuando la pregunta requiera datos concretos (identificadores, conteos, filtros, rankings o los últimos registros).

Reglas:
- Nunca inventes CVEs, puntuaciones, víctimas, fechas ni mensajes: usa solo lo que devuelven las herramientas.
- Si un resultado viene vacío, intenta una vez con filtros más amplios antes de concluir que no hay datos.
- Si la pregunta es conversacional o ya tienes los datos en el historial, responde directamente sin herramientas.
- Cita los identificadores y nombres tal como vienen en los resultados.
- Si un resultado indica que fue truncado o el total supera lo listado, acláralo.
- Si recibes un bloque CONTEXTO con fuentes que el usuario seleccionó, úsalo como base y consulta herramientas solo para completar lo que falte.
- Responde siempre en español, de forma concisa y con markdown (**negritas** para términos clave, listas para enumeraciones).`;
}

/**
 * Agent loop: the model picks tools through native tool-calling until it
 * answers in plain text or the step budget runs out, in which case one last
 * turn without tools forces a closing answer. Provider errors propagate so
 * the caller can fall back to the retrieve path. Priority against embedding
 * sync is the caller's concern: RagService wraps the whole turn.
 */
@Injectable()
export class ChatOrchestrator {
  private readonly logger = new Logger(ChatOrchestrator.name);

  constructor(
    private readonly chat: OllamaChatProvider,
    @Inject(TOOL_EXECUTOR) private readonly tools: ToolExecutor,
    private readonly config: AiConfigService,
    private readonly prefetcher: SourcePrefetcher,
  ) {}

  async ask(input: OrchestratorInput): Promise<OrchestratorResult> {
    const { maxToolSteps, numCtx, queryMaxChars } =
      await this.config.getConfig();
    const messages = this.buildMessages(input);
    const budget = { numCtx, queryMaxChars, turnStart: messages.length - 1 };
    const context: ToolContext = {
      categories: input.categories,
      sources: input.sources,
    };
    const toolsUsed: string[] = [];
    const hasSelectedContext = await this.addSelectedContext(
      messages,
      input,
      numCtx,
      context,
    );

    while (toolsUsed.length < maxToolSteps) {
      const fit = fitContext(messages, this.tools.definitions, budget);
      if (fit.forceClosure) break;
      context.maxResultChars = fit.resultCap;
      const response = await this.chat.chatWithTools(fit.messages, fit.tools);
      if (!response.toolCalls?.length) {
        if (
          toolsUsed.length === 0 &&
          !hasSelectedContext &&
          detectIntents(input.question).length
        ) {
          throw new NoToolCallsError();
        }
        const text = stripToolTags(response.content);
        if (text) {
          return {
            content: text,
            toolSteps: toolsUsed.length,
            forcedClosure: false,
            toolsUsed,
          };
        }
        break;
      }

      const remaining = maxToolSteps - toolsUsed.length;
      for (const call of response.toolCalls.slice(0, remaining)) {
        toolsUsed.push(call.name);
        this.logger.log(`tool step=${toolsUsed.length} name=${call.name}`);
        const result = await this.executeSafely(call, context);
        messages.push(
          toToolCallMessage(call),
          toToolResultMessage(call.name, result),
        );
      }
    }

    const closing = fitContext(
      [...messages, { role: 'user', content: FORCE_CLOSURE_PROMPT }],
      undefined,
      budget,
    );
    const forced = await this.chat.chatWithTools(closing.messages);
    return {
      content: stripToolTags(forced.content) || NO_ANSWER_MESSAGE,
      toolSteps: toolsUsed.length,
      forcedClosure: true,
      toolsUsed,
    };
  }

  /**
   * Prepends the text of the sources selected in the UI to the current question.
   * The block is sized to the context budget up front; a failure or an empty
   * result leaves the question untouched. Returns whether a block was added.
   */
  private async addSelectedContext(
    messages: LlmMessage[],
    input: OrchestratorInput,
    numCtx: number,
    context: ToolContext,
  ): Promise<boolean> {
    if (!input.sources?.length) return false;
    const maxChars =
      prefetchBudgetChars(messages, this.tools.definitions, numCtx) -
      PREFETCH_FRAME_CHARS;
    if (maxChars < MIN_PREFETCH_CHARS) return false;

    try {
      const block = await this.prefetcher.prefetch(
        input.sources,
        (call) => this.executeSafely(call, context),
        maxChars,
      );
      if (!block) return false;
      const last = messages.length - 1;
      messages[last] = {
        ...messages[last],
        content: `${PREFETCH_HEADER}\n${block}\n\nPREGUNTA:\n${messages[last].content}`,
      };
      return true;
    } catch (err: unknown) {
      this.logger.warn(
        `Selected source prefetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private async executeSafely(
    call: ToolCall,
    context: ToolContext,
  ): Promise<unknown> {
    try {
      return await this.tools.execute(call, context);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`tool ${call.name} failed: ${message}`);
      return { error: message };
    }
  }

  private buildMessages(input: OrchestratorInput): LlmMessage[] {
    const history = [...input.history];
    const last = history[history.length - 1];
    if (last?.role === 'user' && last.content === input.question) history.pop();

    return [
      {
        role: 'system',
        content: buildSystemPrompt(new Date().toISOString().split('T')[0]),
      },
      ...history
        .slice(-MAX_HISTORY)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as LlmMessage['role'],
          content: m.content,
        })),
      { role: 'user', content: input.question },
    ];
  }
}
