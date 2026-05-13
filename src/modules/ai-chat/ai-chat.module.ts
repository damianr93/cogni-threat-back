import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { AiChatController } from './ai-chat.controller';
import { AiChatService } from './ai-chat.service';
import { OllamaChatProvider } from './providers/ollama-chat.provider';
import { OllamaEmbeddingsProvider } from './providers/ollama-embeddings.provider';
import { VectorRepository } from './vector/vector.repository';
import { IngestionService } from './ingestion/ingestion.service';
import { SyncSchedulerService } from './ingestion/sync-scheduler.service';
import { RagService } from './rag/rag.service';
import { SecretsModule } from '../../shared/secret-store/secrets.module';
import { AiConfigService } from './ai-config.service';

@Module({
  imports: [DatabaseModule, SecretsModule],
  controllers: [AiChatController],
  providers: [
    AiChatService,
    AiConfigService,
    OllamaChatProvider,
    OllamaEmbeddingsProvider,
    VectorRepository,
    IngestionService,
    SyncSchedulerService,
    RagService,
  ],
  exports: [AiChatService],
})
export class AiChatModule {}
