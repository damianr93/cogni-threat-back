import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { get } from 'env-var';

function monorepoRoot(): string {
  const start = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  let dir = start;
  for (let i = 0; i < 12; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const name = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string }).name;
        if (name === 'cogni-threat') return dir;
      } catch {
        /* ignore */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const envFile = path.join(monorepoRoot(), '.env');
if (existsSync(envFile)) {
  config({ path: envFile });
}

export const envs = {
  // Configuración general de la aplicación
  NODE_ENV: get('NODE_ENV').default('development').asString(),

  // Configuración de API Gateway (cogni-threat)
  API_PORT: get('API_PORT').default(3000).asPortNumber(),
  CORS_ORIGIN: get('CORS_ORIGIN').default('http://localhost:3001').asString(),
  ALLOWED_IPS: get('ALLOWED_IPS').asString(),

  // Configuración de Base de Datos
  DATABASE_URL: get('DATABASE_URL').required().asString(),

  // Configuración de Ransomware API
  RANSOMWARE_API_URL: get('RANSOMWARE_API_URL').default('https://api-pro.ransomware.live').asString(),
  RANSOMWARE_API_KEY: get('RANSOMWARE_API_KEY').asString(),
  RANSOMWARE_RECOVERY_STALE_HOURS: get('RANSOMWARE_RECOVERY_STALE_HOURS').default(24).asIntPositive(),
  RANSOMWARE_RECOVERY_ON_BOOT: get('RANSOMWARE_RECOVERY_ON_BOOT').default('true').asBoolStrict(),

  // Configuración de seguridad
  JWT_SECRET: get('JWT_SECRET').asString(),
  JWT_EXPIRES_IN: get('JWT_EXPIRES_IN').default('24h').asString(),
  PUBLIC_REGISTRATION_ENABLED: get('PUBLIC_REGISTRATION_ENABLED').default('false').asBoolStrict(),
  ADMIN_EMAIL: get('ADMIN_EMAIL').asString(),
  ADMIN_PASSWORD: get('ADMIN_PASSWORD').asString(),

  // Master key para cifrar secretos gestionados desde el panel admin (AES-256-GCM).
  // Debe ser un valor aleatorio de alta entropía (ej: `openssl rand -base64 32`).
  // Si falta, el store cifrado queda deshabilitado y todo cae al fallback de env.
  SECRETS_MASTER_KEY: get('SECRETS_MASTER_KEY').asString(),

  // Configuración de Telegram MTProto (para monitoreo de canales)
  TELEGRAM_API_ID: get('TELEGRAM_API_ID').asString(),
  TELEGRAM_API_HASH: get('TELEGRAM_API_HASH').asString(),
  TELEGRAM_CHANNEL_USERNAME: get('TELEGRAM_CHANNEL_USERNAME').asString(),
  TELEGRAM_SESSION_STRING: get('TELEGRAM_SESSION_STRING').asString(),

  //Bot de telegram
  BOT_TOKEN: get('BOT_TOKEN').asString(),

  // Configuración de NVD API
  NVD_API_URL: get('NVD_API_URL').default('https://services.nvd.nist.gov/rest/json').asString(),
  NVD_API_KEY: get('NVD_API_KEY').asString(),

  // Vuln Monitor — fuentes adicionales
  GITHUB_TOKEN: get('GITHUB_TOKEN').asString(),

  // AI / RAG (Ollama)
  OLLAMA_URL: get('OLLAMA_URL').default('http://localhost:11434').asString(),
  MODEL: get('MODEL').default('gpt-oss').asString(),
  EMBEDDING_MODEL: get('EMBEDDING_MODEL').default('qwen3-embedding').asString(),
  EMBEDDING_DIM: get('EMBEDDING_DIM').default('4096').asIntPositive(),
  OLLAMA_TIMEOUT_MS: get('OLLAMA_TIMEOUT_MS').default('180000').asIntPositive(),
  RAG_RETRIEVE_CANDIDATES: get('RAG_RETRIEVE_CANDIDATES').default('20').asIntPositive(),
  RAG_CHAT_TEMPERATURE: get('RAG_CHAT_TEMPERATURE').default('0.2').asFloat(),
  RAG_CHAT_NUM_CTX: get('RAG_CHAT_NUM_CTX').default('32768').asIntPositive(),
  RAG_QUERY_MAX_CHARS: get('RAG_QUERY_MAX_CHARS').default('3500').asIntPositive(),
  RAG_QUERY_INSTRUCT: get('RAG_QUERY_INSTRUCT').default(
    'Instruct: Given a search query, retrieve relevant passages that answer the query\nQuery: ',
  ).asString(),
};
