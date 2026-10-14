import { Logger } from '@nestjs/common';

export type CveEmbedMode = 'kev' | 'none' | 'all';
export type SourceEmbedMode = 'none' | 'all';

export interface EmbedScope {
  cve: CveEmbedMode;
  victims: SourceEmbedMode;
  telegram: SourceEmbedMode;
}

export interface EmbedScopeEnv {
  RAG_CVE_EMBED_MODE: string;
  RAG_RANSOMWARE_VICTIM_EMBED_MODE: string;
  RAG_TELEGRAM_EMBED_MODE: string;
}

const logger = new Logger('EmbedScope');
const warned = new Set<string>();

/**
 * Resolves one flag. An unrecognised value falls back to the safest reduced
 * mode, so a typo can never silently widen what gets embedded. The warning is
 * emitted once per flag/value because the scope is resolved on every run.
 */
function resolveFlag<T extends string>(
  flag: string,
  raw: string,
  allowed: readonly T[],
  safe: T,
): T {
  const value = raw.trim().toLowerCase();
  const match = allowed.find((mode) => mode === value);
  if (match) return match;

  const key = `${flag}=${raw}`;
  if (!warned.has(key)) {
    warned.add(key);
    logger.warn(
      `Invalid ${flag} "${raw}"; expected one of ${allowed.join('|')}, using "${safe}"`,
    );
  }
  return safe;
}

/**
 * Embedding scope, read from the process environment only (no DB or admin
 * override). Groups and actors are never gated, so they have no flag.
 */
export function resolveEmbedScope(env: EmbedScopeEnv): EmbedScope {
  return {
    cve: resolveFlag(
      'RAG_CVE_EMBED_MODE',
      env.RAG_CVE_EMBED_MODE,
      ['kev', 'none', 'all'],
      'kev',
    ),
    victims: resolveFlag(
      'RAG_RANSOMWARE_VICTIM_EMBED_MODE',
      env.RAG_RANSOMWARE_VICTIM_EMBED_MODE,
      ['none', 'all'],
      'none',
    ),
    telegram: resolveFlag(
      'RAG_TELEGRAM_EMBED_MODE',
      env.RAG_TELEGRAM_EMBED_MODE,
      ['none', 'all'],
      'none',
    ),
  };
}
