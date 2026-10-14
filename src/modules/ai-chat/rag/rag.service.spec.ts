import { Logger } from '@nestjs/common';
import { AiConfigService } from '../ai-config.service';
import { EmbeddingSyncControlService } from '../ingestion/embedding-sync-control.service';
import { RagService } from './rag.service';

const mockEnvs = {
  OLLAMA_URL: 'http://ollama.test:11434',
  MODEL: 'gpt-oss',
  EMBEDDING_MODEL: 'qwen3-embedding',
  OLLAMA_TIMEOUT_MS: 1000,
  RAG_RETRIEVE_CANDIDATES: 8,
  RAG_CHAT_TEMPERATURE: 0.2,
  RAG_CHAT_NUM_CTX: 8192,
  RAG_QUERY_MAX_CHARS: 3500,
  RAG_QUERY_INSTRUCT: 'q',
  RAG_CHAT_MODE: 'retrieve',
  RAG_CHAT_MAX_TOOL_STEPS: 3,
};

jest.mock('libs/config/src/envs', () => ({
  get envs() {
    return mockEnvs;
  },
}));

const VOSEO = /\b(tenés|podés|usá|respondé|decilo|sos|querés|probá|sabés)\b/i;

describe('RagService', () => {
  const opts = {
    question: '¿Qué es CVE-2024-3400?',
    history: [{ role: 'user', content: 'hola' }],
    categories: ['vuln-monitor'],
    sources: ['vuln-monitor:cve:CVE-2024-3400'],
  };

  let sync: EmbeddingSyncControlService;
  let chat: { chat: jest.Mock; chatWithTools: jest.Mock };
  let embeddings: { generateQueryEmbedding: jest.Mock };
  let vectors: { findSimilar: jest.Mock };
  let orchestrator: { ask: jest.Mock };
  let warn: jest.SpyInstance;
  let service: RagService;

  beforeEach(() => {
    mockEnvs.RAG_CHAT_MODE = 'retrieve';
    sync = new EmbeddingSyncControlService();
    chat = {
      chat: jest.fn().mockResolvedValue('respuesta legacy'),
      chatWithTools: jest.fn(),
    };
    embeddings = {
      generateQueryEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
    };
    vectors = {
      findSimilar: jest.fn().mockResolvedValue([
        {
          text: 'PAN-OS RCE',
          source: 'vuln-monitor:cve:CVE-2024-3400',
          category: 'vuln-monitor',
          distance: 0.1,
        },
      ]),
    };
    orchestrator = {
      ask: jest.fn().mockResolvedValue({
        content: 'respuesta con tools',
        toolSteps: 1,
        forcedClosure: false,
        toolsUsed: ['get_cve'],
      }),
    };
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    service = new RagService(
      chat as never,
      embeddings as never,
      vectors as never,
      new AiConfigService({ get: jest.fn().mockResolvedValue(null) } as never),
      sync,
      orchestrator as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('retrieve mode (default)', () => {
    it('embeds, retrieves and generates without ever sending tools', async () => {
      const answer = await service.ask(opts);

      expect(answer).toBe('respuesta legacy');
      expect(orchestrator.ask).not.toHaveBeenCalled();
      expect(chat.chatWithTools).not.toHaveBeenCalled();
      expect(embeddings.generateQueryEmbedding).toHaveBeenCalledWith(
        opts.question,
      );
      expect(vectors.findSimilar).toHaveBeenCalledWith({
        embedding: [0.1, 0.2],
        k: 8,
        categories: ['vuln-monitor'],
        sources: ['vuln-monitor:cve:CVE-2024-3400'],
      });
      const messages = chat.chat.mock.calls[0][0];
      expect(messages[messages.length - 1]).toEqual({
        role: 'user',
        content:
          'CONTEXTO:\n[vuln-monitor] PAN-OS RCE\n(fuente: vuln-monitor:cve:CVE-2024-3400)\n\nPREGUNTA:\n¿Qué es CVE-2024-3400?',
      });
    });

    it('asks without context when nothing is retrieved', async () => {
      vectors.findSimilar.mockResolvedValue([]);

      await service.ask({ question: 'hola', history: [] });

      const messages = chat.chat.mock.calls[0][0];
      expect(messages[messages.length - 1].content).toBe('PREGUNTA:\nhola');
      expect(warn).toHaveBeenCalled();
    });

    it('uses a neutral Spanish system prompt without voseo', async () => {
      await service.ask(opts);

      const system = chat.chat.mock.calls[0][0][0];
      expect(system.role).toBe('system');
      expect(system.content).toMatch(/Responde siempre en español/);
      expect(system.content).not.toMatch(VOSEO);
    });

    it('holds the interactive priority for the whole turn and releases it on error', async () => {
      const seen: number[] = [];
      chat.chat.mockImplementation(async () => {
        seen.push(sync.getStatus().activeInteractiveRequests);
        throw new Error('ollama down');
      });

      await expect(service.ask(opts)).rejects.toThrow('ollama down');

      expect(seen).toEqual([1]);
      expect(sync.getStatus().activeInteractiveRequests).toBe(0);
    });
  });

  describe('tools mode', () => {
    beforeEach(() => {
      mockEnvs.RAG_CHAT_MODE = 'tools';
    });

    it('runs the orchestrator inside the interactive priority and skips the retrieve path', async () => {
      const seen: number[] = [];
      orchestrator.ask.mockImplementation(async () => {
        seen.push(sync.getStatus().activeInteractiveRequests);
        return {
          content: 'respuesta con tools',
          toolSteps: 1,
          forcedClosure: false,
          toolsUsed: ['get_cve'],
        };
      });

      const answer = await service.ask(opts);

      expect(answer).toBe('respuesta con tools');
      expect(seen).toEqual([1]);
      expect(sync.getStatus().activeInteractiveRequests).toBe(0);
      expect(orchestrator.ask).toHaveBeenCalledWith({
        question: opts.question,
        history: opts.history,
        categories: opts.categories,
        sources: opts.sources,
      });
      expect(embeddings.generateQueryEmbedding).not.toHaveBeenCalled();
      expect(chat.chat).not.toHaveBeenCalled();
    });

    it('releases the priority and falls back to retrieve when the orchestrator fails', async () => {
      const seen: number[] = [];
      orchestrator.ask.mockRejectedValue(new Error('loop crashed'));
      chat.chat.mockImplementation(async () => {
        seen.push(sync.getStatus().activeInteractiveRequests);
        return 'respuesta legacy';
      });

      const answer = await service.ask(opts);

      expect(answer).toBe('respuesta legacy');
      expect(seen).toEqual([1]);
      expect(sync.getStatus().activeInteractiveRequests).toBe(0);
      expect(warn.mock.calls.flat().join(' ')).toContain('loop crashed');
    });
  });

  describe('invalid mode', () => {
    it('uses retrieve and warns when RAG_CHAT_MODE is unknown', async () => {
      mockEnvs.RAG_CHAT_MODE = 'banana';

      const answer = await service.ask(opts);

      expect(answer).toBe('respuesta legacy');
      expect(orchestrator.ask).not.toHaveBeenCalled();
      expect(warn.mock.calls.flat().join(' ')).toContain('banana');
    });
  });
});
