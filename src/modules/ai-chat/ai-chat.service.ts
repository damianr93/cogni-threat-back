import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { RagService } from './rag/rag.service';
import { VectorRepository } from './vector/vector.repository';
import { AiConfigService } from './ai-config.service';
import { MOCK_CONTEXT_CATEGORIES } from './mocks/mock-context-categories';
import { deriveLabel } from './ingestion/entity-serializers';
import {
  AskResponse,
  ChatMessage,
  ContextSourcesPage,
  ConversationSummary,
} from './types/chat.types';

@Injectable()
export class AiChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rag: RagService,
    private readonly vectorRepo: VectorRepository,
    private readonly aiConfig: AiConfigService,
  ) {}

  async getHealth() {
    const config = await this.aiConfig.getConfig();
    return {
      success: true,
      data: {
        status: 'ok',
        llm: 'ollama',
        rag: 'pgvector',
        ollamaUrl: config.ollamaUrl,
        model: config.chatModel,
        embeddingModel: config.embeddingModel,
      },
    };
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const convs = await this.prisma.aiConversation.findMany({
      where: { userId, active: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, createdAt: true },
    });
    return convs.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  async createConversation(userId: string, title?: string) {
    const conv = await this.prisma.aiConversation.create({
      data: {
        userId,
        title: title?.trim() || 'Nueva conversación',
      },
    });
    return {
      success: true,
      data: {
        id: conv.id,
        title: conv.title,
        createdAt: conv.createdAt.toISOString(),
      },
    };
  }

  async getHistory(
    conversationId: number,
    userId: string,
  ): Promise<ChatMessage[]> {
    await this.getConversationOrThrow(conversationId, userId);
    const messages = await this.prisma.aiConversationMessage.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'asc' },
    });
    return messages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: m.timestamp.toISOString(),
    }));
  }

  async updateTitle(conversationId: number, title: string, userId: string) {
    await this.getConversationOrThrow(conversationId, userId);
    const updated = await this.prisma.aiConversation.update({
      where: { id: conversationId },
      data: { title: title.trim() },
    });
    return { success: true, data: { id: updated.id, title: updated.title } };
  }

  async deleteConversation(conversationId: number, userId: string) {
    await this.getConversationOrThrow(conversationId, userId);
    await this.prisma.aiConversation.update({
      where: { id: conversationId },
      data: { active: false },
    });
    return { success: true, data: { conversationId } };
  }

  async ask(
    conversationId: number,
    question: string,
    userId: string,
    categories?: string[],
    sources?: string[],
  ): Promise<{ success: true; data: AskResponse }> {
    const conv = await this.getConversationOrThrow(conversationId, userId);
    const now = new Date();

    await this.prisma.aiConversationMessage.create({
      data: {
        conversationId,
        role: 'user',
        content: question,
        timestamp: now,
      },
    });

    const historyRows = await this.prisma.aiConversationMessage.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'asc' },
      take: 12,
    });
    const history = historyRows.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const responseText = await this.rag.ask({
      question,
      history,
      categories,
      sources,
    });

    const assistantTs = new Date();
    await this.prisma.aiConversationMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content: responseText,
        timestamp: assistantTs,
      },
    });

    if (conv.title === 'Nueva conversación') {
      const autoTitle =
        question.slice(0, 60) + (question.length > 60 ? '…' : '');
      await this.prisma.aiConversation.update({
        where: { id: conversationId },
        data: { title: autoTitle },
      });
    }

    return {
      success: true,
      data: {
        response: responseText,
        conversationId,
        timestamp: assistantTs.toISOString(),
      },
    };
  }

  getContextCategories() {
    return MOCK_CONTEXT_CATEGORIES;
  }

  async getContextIndexStats() {
    return this.vectorRepo.countByCategory();
  }

  async getContextSources(
    page = 1,
    limit = 20,
    search?: string,
    category?: string,
  ): Promise<ContextSourcesPage> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const safePage = Math.max(page, 1);
    const offset = (safePage - 1) * safeLimit;

    const { items, total } = await this.vectorRepo.listSources({
      limit: safeLimit,
      offset,
      category,
      search,
    });

    const mappedItems = items.map((row) => ({
      id: row.source,
      label: deriveLabel(row.source, row.summary),
      category: row.category,
      summary: row.summary || undefined,
    }));

    return {
      items: mappedItems,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit) || 1,
    };
  }

  private async getConversationOrThrow(conversationId: number, userId: string) {
    const conv = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, userId, active: true },
    });
    if (!conv) {
      throw new NotFoundException(
        `Conversación ${conversationId} no encontrada`,
      );
    }
    return conv;
  }
}
