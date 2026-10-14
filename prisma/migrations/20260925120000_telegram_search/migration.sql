-- Telegram full-text search + trigram fallback for the AI chat tools.
-- Additive only. The two to_tsvector expression indexes cannot be declared in
-- schema.prisma; SearchIndexBootstrap re-creates them at boot if they go missing.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS telegram_msg_fts_simple_idx ON telegram_channel_messages USING GIN (to_tsvector('simple', content));
CREATE INDEX IF NOT EXISTS telegram_msg_fts_spanish_idx ON telegram_channel_messages USING GIN (to_tsvector('spanish', content));

CREATE INDEX IF NOT EXISTS telegram_msg_content_trgm_idx ON telegram_channel_messages USING GIN (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vuln_cves_id_trgm_idx ON vuln_cves USING GIN (id gin_trgm_ops);
