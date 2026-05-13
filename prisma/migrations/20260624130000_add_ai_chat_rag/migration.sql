-- Habilitar extensión pgvector (requiere superuser)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable: conversaciones AI
CREATE TABLE IF NOT EXISTS "ai_conversations" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'default-user',
    "title" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: mensajes de conversaciones AI
CREATE TABLE IF NOT EXISTS "ai_conversation_messages" (
    "id" TEXT NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable: estado de sincronización por fuente
CREATE TABLE IF NOT EXISTS "ai_sync_states" (
    "source" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "lastCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_sync_states_pkey" PRIMARY KEY ("source")
);

-- CreateTable: índice vectorial de contexto (fuera del schema Prisma, gestionado por VectorRepository)
CREATE TABLE IF NOT EXISTS ai_context_vectors (
    id           SERIAL PRIMARY KEY,
    text         TEXT NOT NULL,
    embedding    halfvec(4096),
    source       VARCHAR NOT NULL,
    category     VARCHAR NOT NULL,
    chunk_index  INTEGER DEFAULT 0,
    total_chunks INTEGER DEFAULT 1,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS idx_ai_vectors_source   ON ai_context_vectors (source);
CREATE INDEX IF NOT EXISTS idx_ai_vectors_category ON ai_context_vectors (category);

-- AddForeignKey
ALTER TABLE "ai_conversation_messages"
    ADD CONSTRAINT "ai_conversation_messages_conversationId_fkey"
    FOREIGN KEY ("conversationId")
    REFERENCES "ai_conversations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
