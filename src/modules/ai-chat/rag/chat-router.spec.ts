import { Logger } from '@nestjs/common';
import { ChatRouter, detectIntents, NO_DATA_MESSAGE } from './chat-router';

const VOSEO = /\b(tenés|podés|usá|respondé|decilo|sos|querés|probá|sabés)\b/i;

describe('detectIntents', () => {
  const names = (q: string) => detectIntents(q).map((c) => c.name);

  it('maps "CVEs affecting nginx" to search_cves', () => {
    expect(detectIntents('CVEs affecting nginx')).toEqual([
      { name: 'search_cves', arguments: { query: 'nginx' } },
    ]);
  });

  it('maps CVE ids to get_cve, deduplicated and uppercased', () => {
    expect(
      detectIntents('compara cve-2024-3400 con CVE-2023-4863 y CVE-2024-3400'),
    ).toEqual([
      { name: 'get_cve', arguments: { cveId: 'CVE-2024-3400' } },
      { name: 'get_cve', arguments: { cveId: 'CVE-2023-4863' } },
    ]);
  });

  it('sets isKev when the question mentions KEV', () => {
    expect(detectIntents('vulnerabilidades KEV de Fortinet')[0]).toEqual({
      name: 'search_cves',
      arguments: { query: 'fortinet', isKev: true },
    });
  });

  it('matches ransomware victims and groups ignoring accents', () => {
    expect(names('últimas víctimas de ransomware')).toEqual([
      'search_ransomware_victims',
    ]);
    expect(detectIntents('háblame del grupo lockbit')).toEqual([
      { name: 'get_ransomware_group', arguments: { name: 'lockbit' } },
    ]);
  });

  it('maps actors and telegram', () => {
    expect(detectIntents('actor APT28')[0]).toEqual({
      name: 'search_actors',
      arguments: { query: 'apt28' },
    });
    expect(detectIntents('mensajes del canal @darkleaks sobre botnet')).toEqual(
      [
        {
          name: 'search_telegram_messages',
          arguments: { keywords: ['botnet'], channel: 'darkleaks' },
        },
      ],
    );
  });

  it('keeps a fixed intent order and at most 3 calls', () => {
    const calls = names(
      'CVE-2024-3400 y CVE-2023-4863 CVE-2022-1234 en telegram, víctimas ransomware, cve y actor',
    );
    expect(calls).toEqual(['get_cve', 'get_cve', 'get_cve']);
    expect(
      names('telegram, víctimas ransomware, cve críticas y actor apt'),
    ).toEqual([
      'search_telegram_messages',
      'search_ransomware_victims',
      'search_cves',
    ]);
  });

  it('returns nothing when no intent matches', () => {
    expect(detectIntents('hola, ¿cómo estás?')).toEqual([]);
  });
});

describe('ChatRouter', () => {
  function make(results: Record<string, unknown>) {
    const execute = jest.fn(async (call: { name: string }) => {
      const r = results[call.name];
      if (r instanceof Error) throw r;
      return r ?? { items: [] };
    });
    const chat = { chat: jest.fn().mockResolvedValue('respuesta final') };
    const config = {
      getConfig: jest
        .fn()
        .mockResolvedValue({ numCtx: 8192, queryMaxChars: 3500 }),
    };
    const router = new ChatRouter(
      chat as never,
      { definitions: [], execute } as never,
      config as never,
    );
    return { router, execute, chat };
  }
  const input = { question: 'CVEs affecting nginx', history: [] };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('runs the registry tool and grounds the answer in a CONTEXTO block', async () => {
    const { router, execute, chat } = make({
      search_cves: { total: 1, items: [{ id: 'CVE-2024-0001' }] },
    });

    const out = await router.ask({
      ...input,
      categories: ['vuln-monitor'],
      sources: ['s'],
    });

    expect(out).toEqual({
      content: 'respuesta final',
      toolsUsed: ['search_cves'],
    });
    expect(execute).toHaveBeenCalledWith(
      { name: 'search_cves', arguments: { query: 'nginx' } },
      expect.objectContaining({ categories: ['vuln-monitor'], sources: ['s'] }),
    );
    const messages = chat.chat.mock.calls[0][0];
    expect(messages[0].content).toMatch(/Responde siempre en español/);
    expect(messages[0].content).not.toMatch(VOSEO);
    expect(messages[messages.length - 1].content).toContain('CONTEXTO');
    expect(messages[messages.length - 1].content).toContain('CVE-2024-0001');
  });

  it('falls back to semantic_search when no intent matches', async () => {
    const { router, execute } = make({
      semantic_search: { items: [{ t: 1 }] },
    });

    const out = await router.ask({ question: 'hola', history: [] });

    expect(execute.mock.calls[0][0]).toEqual({
      name: 'semantic_search',
      arguments: { query: 'hola' },
    });
    expect(out.toolsUsed).toEqual(['semantic_search']);
  });

  it('answers with a Spanish no-data reply without calling the model when every tool is empty', async () => {
    const { router, chat } = make({
      search_cves: { total: 0, items: [] },
    });

    const out = await router.ask(input);

    expect(out.content).toBe(NO_DATA_MESSAGE);
    expect(NO_DATA_MESSAGE).not.toMatch(VOSEO);
    expect(chat.chat).not.toHaveBeenCalled();
  });

  it('treats found:false as no data and skips error results as context', async () => {
    const { router, chat } = make({
      get_cve: { found: false, cveId: 'CVE-2024-1111' },
    });
    const out = await router.ask({ question: 'CVE-2024-1111', history: [] });
    expect(out.content).toBe(NO_DATA_MESSAGE);
    expect(chat.chat).not.toHaveBeenCalled();
  });

  it('throws when every tool failed so the caller can try retrieve', async () => {
    const { router } = make({ search_cves: { error: 'boom' } });
    await expect(router.ask(input)).rejects.toThrow(/router/i);

    const thrown = make({ search_cves: new Error('db down') });
    await expect(thrown.router.ask(input)).rejects.toThrow(/router/i);
  });
});
