import type { envs as Envs } from 'libs/config/src/envs';
import { resolveEmbedScope } from './ingestion/embed-scope';

jest.mock('dotenv', () => ({ config: jest.fn() }));

const FLAGS = [
  'RAG_CHAT_MODE',
  'RAG_CVE_EMBED_MODE',
  'RAG_RANSOMWARE_VICTIM_EMBED_MODE',
  'RAG_TELEGRAM_EMBED_MODE',
] as const;

/** Loads `envs` fresh with only the given flags present in the environment. */
function loadEnvs(flags: Partial<Record<(typeof FLAGS)[number], string>> = {}) {
  const saved = Object.fromEntries(FLAGS.map((f) => [f, process.env[f]]));
  FLAGS.forEach((f) => delete process.env[f]);
  Object.assign(process.env, flags);
  try {
    let loaded!: typeof Envs;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = (require('libs/config/src/envs') as { envs: typeof Envs }).envs;
    });
    return loaded;
  } finally {
    FLAGS.forEach((f) => {
      if (saved[f] === undefined) delete process.env[f];
      else process.env[f] = saved[f];
    });
  }
}

describe('AI flag defaults', () => {
  it('chats with tools and embeds the reduced scope when nothing is set', () => {
    const envs = loadEnvs();

    expect(envs.RAG_CHAT_MODE).toBe('tools');
    expect(envs.RAG_CVE_EMBED_MODE).toBe('kev');
    expect(envs.RAG_RANSOMWARE_VICTIM_EMBED_MODE).toBe('none');
    expect(envs.RAG_TELEGRAM_EMBED_MODE).toBe('none');
    expect(resolveEmbedScope(envs)).toEqual({
      cve: 'kev',
      victims: 'none',
      telegram: 'none',
    });
  });

  it('still honours explicit values for the legacy behaviour', () => {
    const envs = loadEnvs({
      RAG_CHAT_MODE: 'retrieve',
      RAG_CVE_EMBED_MODE: 'all',
      RAG_RANSOMWARE_VICTIM_EMBED_MODE: 'all',
      RAG_TELEGRAM_EMBED_MODE: 'all',
    });

    expect(envs.RAG_CHAT_MODE).toBe('retrieve');
    expect(resolveEmbedScope(envs)).toEqual({
      cve: 'all',
      victims: 'all',
      telegram: 'all',
    });
  });
});
