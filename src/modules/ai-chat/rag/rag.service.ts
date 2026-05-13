import { Injectable, Logger } from '@nestjs/common';
import { OllamaChatProvider } from '../providers/ollama-chat.provider';
import { OllamaEmbeddingsProvider } from '../providers/ollama-embeddings.provider';
import { VectorRepository } from '../vector/vector.repository';
import { AiConfigService } from '../ai-config.service';

const SYSTEM_PROMPT = `Eres un asistente especializado en inteligencia de amenazas cibernéticas.
Tienes acceso a datos actualizados de:
- Grupos ransomware y sus víctimas (fuente: ransomware.live)
- Vulnerabilidades CVE con puntuación CVSS, EPSS, KEV (NIST NVD, GitHub Advisory, OSV)
- Actores de amenaza APT y sus hitos documentados
- Desinformación y fake news detectadas en ciberseguridad
- Mensajes de canales Telegram monitoreados

Responde siempre en español. Sé preciso y factual.
Cuando el contexto provea datos, úsalos directamente y menciona brevemente la fuente.
Si no tenés información suficiente sobre algo, decilo claramente en lugar de inventar.
Usá markdown: **negritas** para términos clave, listas para enumeraciones.
Sé conciso — respondé lo que se pregunta sin agregar información innecesaria.`;

const MAX_HISTORY = 6;

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly chat: OllamaChatProvider,
    private readonly embeddings: OllamaEmbeddingsProvider,
    private readonly vectors: VectorRepository,
    private readonly config: AiConfigService,
  ) {}

  async ask(opts: {
    question: string;
    history: Array<{ role: string; content: string }>;
    categories?: string[];
    sources?: string[];
  }): Promise<string> {
    const { question, history, categories, sources } = opts;

    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embeddings.generateQueryEmbedding(question);
    } catch (err: any) {
      this.logger.error(`Error generando embedding de consulta: ${err?.message}`);
      throw err;
    }

    const aiConfig = await this.config.getConfig();
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
      this.logger.warn(`Sin resultados en el índice vectorial para: "${question.slice(0, 80)}"`);
    }

    const response = await this.chat.chat(messages);
    return response;
  }

  private buildContext(
    chunks: Array<{ text: string; source: string; category: string; distance: number }>,
  ): string {
    return chunks
      .map((c) => `[${c.category}] ${c.text}\n(fuente: ${c.source})`)
      .join('\n\n---\n\n');
  }
}
