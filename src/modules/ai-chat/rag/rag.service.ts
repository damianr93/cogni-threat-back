import { Injectable, Logger } from '@nestjs/common';
import { OllamaChatProvider } from '../providers/ollama-chat.provider';
import { OllamaEmbeddingsProvider } from '../providers/ollama-embeddings.provider';
import { VectorRepository } from '../vector/vector.repository';
import { AiConfigService, AiRuntimeConfig } from '../ai-config.service';
import { EmbeddingSyncControlService } from '../ingestion/embedding-sync-control.service';
import { ModelCapabilityService } from '../capability/model-capability.service';
import { ToolsNotSupportedError } from '../providers/ollama-chat.provider';
import { AskMeta, DegradedReason } from '../types/chat.types';
import { ChatOrchestrator, NoToolCallsError } from './chat-orchestrator';
import { ChatRouter } from './chat-router';
import { ContextBudgetConfigError } from './context-budget';
import { degradedNotice } from './degraded-notice';

const SYSTEM_PROMPT = `Eres un asistente especializado en inteligencia de amenazas cibernéticas.
Tienes acceso a datos actualizados de:
- Grupos ransomware y sus víctimas (fuente: ransomware.live)
- Vulnerabilidades CVE con puntuación CVSS, EPSS, KEV (NIST NVD, GitHub Advisory, OSV)
- Actores de amenaza APT y sus hitos documentados
- Mensajes de canales Telegram monitoreados

Responde siempre en español. Sé preciso y factual.
Cuando el contexto provea datos, úsalos directamente y menciona brevemente la fuente.
Si no tienes información suficiente sobre algo, indícalo claramente en lugar de inventar.
Usa markdown: **negritas** para términos clave, listas para enumeraciones.
Sé conciso: responde lo que se pregunta sin agregar información innecesaria.`;

const MAX_HISTORY = 6;

export interface AskOptions {
  question: string;
  history: Array<{ role: string; content: string }>;
  categories?: string[];
  sources?: string[];
}

/** `meta` is omitted in retrieve mode so the default response is unchanged. */
export interface AskResult {
  content: string;
  meta?: AskMeta;
}

function degradedReason(err: unknown): DegradedReason {
  if (err instanceof ToolsNotSupportedError) return 'model_without_tools';
  if (err instanceof NoToolCallsError) return 'no_tool_calls';
  return 'orchestrator_error';
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly chat: OllamaChatProvider,
    private readonly embeddings: OllamaEmbeddingsProvider,
    private readonly vectors: VectorRepository,
    private readonly config: AiConfigService,
    private readonly embeddingSyncControl: EmbeddingSyncControlService,
    private readonly orchestrator: ChatOrchestrator,
    private readonly router: ChatRouter,
    private readonly capability: ModelCapabilityService,
  ) {}

  /**
   * The whole turn, tools loop included, runs inside the interactive priority so
   * embedding sync yields until the answer is produced. In tools mode the chain
   * is tools -> deterministic router -> legacy retrieve; every step after the
   * first is flagged as degraded. A context budget config error is never
   * degraded: it is an operator problem and propagates.
   */
  async ask(opts: AskOptions): Promise<AskResult> {
    return this.embeddingSyncControl.runWithInteractivePriority(async () => {
      const aiConfig = await this.config.getConfig();

      if (aiConfig.chatMode !== 'tools') {
        return { content: await this.askWithRetrieve(opts, aiConfig) };
      }

      let reason: DegradedReason;
      if ((await this.capability.getToolSupport()) === 'unsupported') {
        reason = 'model_without_tools';
      } else {
        try {
          const result = await this.orchestrator.ask(opts);
          this.logger.log(
            `Tools answer: ${result.toolSteps} steps${result.forcedClosure ? ' (forced closure)' : ''}`,
          );
          return {
            content: result.content,
            meta: { via: 'tools', degraded: false, tools: result.toolsUsed },
          };
        } catch (err: unknown) {
          if (err instanceof ContextBudgetConfigError) throw err;
          reason = degradedReason(err);
          if (err instanceof ToolsNotSupportedError) {
            await this.capability.markUnsupported();
          }
          this.logger.warn(
            `Tools mode degraded (${reason}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const notice = degradedNotice(reason, aiConfig.chatModel);
      try {
        const routed = await this.router.ask(opts);
        return {
          content: routed.content + notice,
          meta: {
            via: 'router',
            degraded: true,
            reason,
            tools: routed.toolsUsed,
          },
        };
      } catch (err: unknown) {
        if (err instanceof ContextBudgetConfigError) throw err;
        this.logger.warn(
          `Router failed, falling back to retrieve: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return {
        content: (await this.askWithRetrieve(opts, aiConfig)) + notice,
        meta: { via: 'retrieve', degraded: true, reason },
      };
    });
  }

  private async askWithRetrieve(
    opts: AskOptions,
    aiConfig: AiRuntimeConfig,
  ): Promise<string> {
    const { question, history, categories, sources } = opts;

    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embeddings.generateQueryEmbedding(question);
    } catch (err: unknown) {
      this.logger.error(
        `Query embedding failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    const chunks = await this.vectors.findSimilar({
      embedding: queryEmbedding,
      k: aiConfig.retrieveCandidates,
      categories: categories && categories.length > 0 ? categories : undefined,
      sources: sources && sources.length > 0 ? sources : undefined,
    });

    const contextStr = chunks.length > 0 ? this.buildContext(chunks) : '';

    const recentHistory = history.slice(-MAX_HISTORY);

    const userContent = contextStr
      ? `CONTEXTO:\n${contextStr}\n\nPREGUNTA:\n${question}`
      : `PREGUNTA:\n${question}`;

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...recentHistory,
      { role: 'user', content: userContent },
    ];

    if (chunks.length === 0) {
      this.logger.warn(
        `No vector index results for: "${question.slice(0, 80)}"`,
      );
    }

    const response = await this.chat.chat(messages);
    return response;
  }

  private buildContext(
    chunks: Array<{
      text: string;
      source: string;
      category: string;
      distance: number;
    }>,
  ): string {
    return chunks
      .map((c) => `[${c.category}] ${c.text}\n(fuente: ${c.source})`)
      .join('\n\n---\n\n');
  }
}
