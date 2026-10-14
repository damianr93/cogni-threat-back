import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { AiChatController } from './ai-chat.controller';
import { AiChatService } from './ai-chat.service';
import { OllamaChatProvider } from './providers/ollama-chat.provider';
import { OllamaEmbeddingsProvider } from './providers/ollama-embeddings.provider';
import { VectorRepository } from './vector/vector.repository';
import { IngestionService } from './ingestion/ingestion.service';
import { SyncSchedulerService } from './ingestion/sync-scheduler.service';
import { EmbeddingSyncControlService } from './ingestion/embedding-sync-control.service';
import { RagService } from './rag/rag.service';
import { ChatOrchestrator, TOOL_EXECUTOR } from './rag/chat-orchestrator';
import { ToolRegistry } from './tools/tool-registry';
import { CHAT_TOOLS } from './tools/tool.types';
import { buildChatTools } from './tools/chat-tools';
import { VulnMonitorModule } from '../vuln-monitor/vuln-monitor.module';
import { VulnCveRepository } from '../vuln-monitor/repositories/vuln-cve.repository';
import { PrismaService } from '../../shared/database/prisma.service';
import { SecretsModule } from '../../shared/secret-store/secrets.module';
import { AiConfigService } from './ai-config.service';

@Module({
  imports: [DatabaseModule, SecretsModule, VulnMonitorModule],
  controllers: [AiChatController],
  providers: [
    AiChatService,
    AiConfigService,
    OllamaChatProvider,
    OllamaEmbeddingsProvider,
    VectorRepository,
    EmbeddingSyncControlService,
    IngestionService,
    SyncSchedulerService,
    RagService,
    ChatOrchestrator,
    {
      provide: CHAT_TOOLS,
      // Later slices add their repositories to `inject` and `ChatToolDeps`.
      useFactory: (
        cves: VulnCveRepository,
        prisma: PrismaService,
        vectors: VectorRepository,
        embeddings: OllamaEmbeddingsProvider,
      ) => buildChatTools({ cves, prisma, vectors, embeddings }),
      inject: [
        VulnCveRepository,
        PrismaService,
        VectorRepository,
        OllamaEmbeddingsProvider,
      ],
    },
    { provide: TOOL_EXECUTOR, useClass: ToolRegistry },
  ],
  exports: [AiChatService],
})
export class AiChatModule {}
