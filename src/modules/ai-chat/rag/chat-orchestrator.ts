import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiConfigService } from '../ai-config.service';
import { OllamaChatProvider } from '../providers/ollama-chat.provider';
import {
  stripToolTags,
  toToolCallMessage,
  toToolResultMessage,
} from '../providers/tool-wire';
import { LlmMessage, ToolCall, ToolDefinition } from '../types/chat.types';

const MAX_HISTORY = 6;

const FORCE_CLOSURE_PROMPT =
  'Ya no puedes usar más herramientas. Responde ahora la pregunta original usando solo los resultados obtenidos; ' +
  'si no alcanzan, indica qué información falta.';

export const NO_ANSWER_MESSAGE =
  'No pude generar una respuesta con los datos disponibles. Intenta reformular la pregunta.';

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
  ) {}

  async ask(input: OrchestratorInput): Promise<OrchestratorResult> {
    const { maxToolSteps } = await this.config.getConfig();
    const messages = this.buildMessages(input);
    const context: ToolContext = {
      categories: input.categories,
      sources: input.sources,
    };
    const toolsUsed: string[] = [];

    while (toolsUsed.length < maxToolSteps) {
      const response = await this.chat.chatWithTools(
        messages,
        this.tools.definitions,
      );
      if (!response.toolCalls?.length) {
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

    const forced = await this.chat.chatWithTools([
      ...messages,
      { role: 'user', content: FORCE_CLOSURE_PROMPT },
    ]);
    return {
      content: stripToolTags(forced.content) || NO_ANSWER_MESSAGE,
      toolSteps: toolsUsed.length,
      forcedClosure: true,
      toolsUsed,
    };
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
