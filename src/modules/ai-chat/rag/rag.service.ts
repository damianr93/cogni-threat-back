import { Injectable, Logger } from '@nestjs/common';
import { OllamaChatProvider } from '../providers/ollama-chat.provider';
import { OllamaEmbeddingsProvider } from '../providers/ollama-embeddings.provider';
import { VectorRepository } from '../vector/vector.repository';
import { AiConfigService, AiRuntimeConfig } from '../ai-config.service';
import { EmbeddingSyncControlService } from '../ingestion/embedding-sync-control.service';
import { ChatOrchestrator } from './chat-orchestrator';

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
  ) {}

  /**
   * The whole turn, tools loop included, runs inside the interactive priority so
   * embedding sync yields until the answer is produced. A failing tools turn
   * degrades to retrieve-then-generate instead of failing the request.
   */
  async ask(opts: {
    question: string;
    history: Array<{ role: string; content: string }>;
    categories?: string[];
    sources?: string[];
  }): Promise<string> {
    return this.embeddingSyncControl.runWithInteractivePriority(async () => {
      const aiConfig = await this.config.getConfig();

      if (aiConfig.chatMode === 'tools') {
        try {
          const result = await this.orchestrator.ask(opts);
          this.logger.log(
            `Tools answer: ${result.toolSteps} steps${result.forcedClosure ? ' (forced closure)' : ''}`,
          );
          return result.content;
        } catch (err: unknown) {
          this.logger.warn(
            `Tools mode failed, falling back to retrieve: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return this.askWithRetrieve(opts, aiConfig);
    });
  }

  private async askWithRetrieve(
    opts: {
      question: string;
      history: Array<{ role: string; content: string }>;
      categories?: string[];
      sources?: string[];
    },
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
