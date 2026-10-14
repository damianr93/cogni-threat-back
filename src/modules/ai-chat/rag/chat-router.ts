import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiConfigService } from '../ai-config.service';
import { OllamaChatProvider } from '../providers/ollama-chat.provider';
import { LlmMessage } from '../types/chat.types';
import { detectIntents, RouterCall } from './router-intents';
import { fitContext } from './context-budget';
import { TOOL_EXECUTOR } from './chat-orchestrator';
import type {
  OrchestratorInput,
  ToolContext,
  ToolExecutor,
} from './chat-orchestrator';

const RESULT_CHARS = 2000;

export { detectIntents };

export const NO_DATA_MESSAGE =
  'No encontré datos en la base de Cogni que respondan a esta consulta. Prueba con otros términos o filtros.';

const SYSTEM_PROMPT = `Eres el asistente de inteligencia de amenazas de Cogni.
Se te entrega un bloque CONTEXTO con resultados reales de la base de datos de Cogni.
Reglas:
- Responde usando solo el CONTEXTO; nunca inventes CVEs, puntuaciones, víctimas, fechas ni mensajes.
- Si el CONTEXTO no alcanza para responder, indica qué información falta.
- Cita los identificadores y nombres tal como vienen en los resultados y aclara si fueron truncados.
- Responde siempre en español, de forma concisa y con markdown.`;

function hasData(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  if ('error' in r || r.found === false) return false;
  if (Array.isArray(r.items)) return r.items.length > 0;
  if (Array.isArray(r.actors)) return r.actors.length > 0;
  return true;
}

export interface RouterResult {
  content: string;
  toolsUsed: string[];
}

/**
 * Code-side pre-retrieval for models that cannot call tools: runs the same
 * registry tools the model would have used, then answers from their output
 * with one tool-less chat call. No data means a fixed reply, never a guess.
 */
@Injectable()
export class ChatRouter {
  private readonly logger = new Logger(ChatRouter.name);

  constructor(
    private readonly chat: OllamaChatProvider,
    @Inject(TOOL_EXECUTOR) private readonly tools: ToolExecutor,
    private readonly config: AiConfigService,
  ) {}

  async ask(input: OrchestratorInput): Promise<RouterResult> {
    const intents = detectIntents(input.question);
    const calls = intents.length
      ? intents
      : [{ name: 'semantic_search', arguments: { query: input.question } }];
    const context: ToolContext = {
      categories: input.categories,
      sources: input.sources,
      maxResultChars: RESULT_CHARS,
    };

    const results: unknown[] = [];
    for (const call of calls) {
      this.logger.log(`router tool=${call.name}`);
      results.push(await this.runSafely(call, context));
    }
    const toolsUsed = calls.map((c) => c.name);

    const usable = calls.filter((_, i) => hasData(results[i]));
    if (usable.length === 0) {
      if (results.every((r) => r && typeof r === 'object' && 'error' in r)) {
        throw new Error('router: every tool failed');
      }
      return { content: NO_DATA_MESSAGE, toolsUsed };
    }

    const block = calls
      .map((c, i) => ({ c, r: results[i] }))
      .filter(({ r }) => hasData(r))
      .map(({ c, r }) => `[${c.name}] ${JSON.stringify(r)}`)
      .join('\n\n');
    const { numCtx, queryMaxChars } = await this.config.getConfig();
    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `CONTEXTO:\n${block}\n\nPREGUNTA:\n${input.question}`,
      },
    ];
    const fit = fitContext(messages, undefined, {
      numCtx,
      queryMaxChars,
      turnStart: 1,
    });
    return { content: await this.chat.chat(fit.messages), toolsUsed };
  }

  private async runSafely(
    call: RouterCall,
    context: ToolContext,
  ): Promise<unknown> {
    try {
      return await this.tools.execute(call, context);
    } catch (err: unknown) {
      this.logger.warn(
        `router tool ${call.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { error: 'tool failed' };
    }
  }
}
