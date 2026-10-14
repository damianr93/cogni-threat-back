import { Logger } from '@nestjs/common';
import { AiConfigService } from '../ai-config.service';
import { EmbeddingSyncControlService } from '../ingestion/embedding-sync-control.service';
import { ToolsNotSupportedError } from '../providers/ollama-chat.provider';
import { ContextBudgetConfigError } from './context-budget';
import { NoToolCallsError } from './chat-orchestrator';
import { degradedNotice } from './degraded-notice';
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
  let router: { ask: jest.Mock };
  let capability: { getToolSupport: jest.Mock; markUnsupported: jest.Mock };
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
    router = {
      ask: jest.fn().mockResolvedValue({
        content: 'respuesta del router',
        toolsUsed: ['search_cves'],
      }),
    };
    capability = {
      getToolSupport: jest.fn().mockResolvedValue('supported'),
      markUnsupported: jest.fn().mockResolvedValue(undefined),
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
      router as never,
      capability as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('retrieve mode (default)', () => {
    it('embeds, retrieves and generates without ever sending tools', async () => {
      const answer = await service.ask(opts);

      expect(answer).toEqual({ content: 'respuesta legacy' });
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

      expect(answer).toEqual({
        content: 'respuesta con tools',
        meta: { via: 'tools', degraded: false, tools: ['get_cve'] },
      });
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

      router.ask.mockRejectedValue(new Error('router failed'));

      const answer = await service.ask(opts);

      expect(answer.content).toBe(
        `respuesta legacy${degradedNotice('orchestrator_error', 'gpt-oss')}`,
      );
      expect(answer.meta).toEqual({
        via: 'retrieve',
        degraded: true,
        reason: 'orchestrator_error',
      });
      expect(seen).toEqual([1]);
      expect(sync.getStatus().activeInteractiveRequests).toBe(0);
      expect(warn.mock.calls.flat().join(' ')).toContain('loop crashed');
    });

    describe('fallback chain', () => {
      const routed = (reason: string) => ({
        content: `respuesta del router${degradedNotice(reason as never, 'gpt-oss')}`,
        meta: {
          via: 'router',
          degraded: true,
          reason,
          tools: ['search_cves'],
        },
      });

      it('goes straight to the router when the model is known to lack tools', async () => {
        capability.getToolSupport.mockResolvedValue('unsupported');

        const answer = await service.ask(opts);

        expect(answer).toEqual(routed('model_without_tools'));
        expect(orchestrator.ask).not.toHaveBeenCalled();
        expect(router.ask).toHaveBeenCalledWith(opts);
      });

      it('tries tools normally when the capability is unknown', async () => {
        capability.getToolSupport.mockResolvedValue('unknown');

        const answer = await service.ask(opts);

        expect(answer.meta?.via).toBe('tools');
        expect(router.ask).not.toHaveBeenCalled();
      });

      it('marks the model unsupported and routes when the provider rejects tools', async () => {
        orchestrator.ask.mockRejectedValue(
          new ToolsNotSupportedError('gpt-oss'),
        );

        const answer = await service.ask(opts);

        expect(capability.markUnsupported).toHaveBeenCalledTimes(1);
        expect(answer).toEqual(routed('model_without_tools'));
      });

      it('routes with reason no_tool_calls when the model skips tools for a data question', async () => {
        orchestrator.ask.mockRejectedValue(new NoToolCallsError());

        const answer = await service.ask(opts);

        expect(capability.markUnsupported).not.toHaveBeenCalled();
        expect(answer).toEqual(routed('no_tool_calls'));
      });

      it('routes with reason orchestrator_error on any other orchestrator failure', async () => {
        orchestrator.ask.mockRejectedValue(new Error('loop crashed'));

        const answer = await service.ask(opts);

        expect(answer).toEqual(routed('orchestrator_error'));
        expect(chat.chat).not.toHaveBeenCalled();
      });

      it('keeps the original reason when the router also fails and retrieve answers', async () => {
        capability.getToolSupport.mockResolvedValue('unsupported');
        router.ask.mockRejectedValue(new Error('router: every tool failed'));

        const answer = await service.ask(opts);

        expect(answer.meta).toEqual({
          via: 'retrieve',
          degraded: true,
          reason: 'model_without_tools',
        });
        expect(answer.content).toContain('respuesta legacy');
        expect(answer.content).toContain('Modo degradado');
      });

      it('propagates a context budget config error instead of degrading', async () => {
        orchestrator.ask.mockRejectedValue(
          new ContextBudgetConfigError(9000, 7000),
        );

        await expect(service.ask(opts)).rejects.toBeInstanceOf(
          ContextBudgetConfigError,
        );
        expect(router.ask).not.toHaveBeenCalled();
        expect(chat.chat).not.toHaveBeenCalled();
      });

      it('propagates a config error raised by the router too', async () => {
        capability.getToolSupport.mockResolvedValue('unsupported');
        router.ask.mockRejectedValue(new ContextBudgetConfigError(9000, 7000));

        await expect(service.ask(opts)).rejects.toBeInstanceOf(
          ContextBudgetConfigError,
        );
        expect(chat.chat).not.toHaveBeenCalled();
      });

      it('runs the router inside the interactive priority', async () => {
        capability.getToolSupport.mockResolvedValue('unsupported');
        const seen: number[] = [];
        router.ask.mockImplementation(async () => {
          seen.push(sync.getStatus().activeInteractiveRequests);
          return { content: 'r', toolsUsed: [] };
        });

        await service.ask(opts);

        expect(seen).toEqual([1]);
      });
    });
  });

  describe('invalid mode', () => {
    it('uses retrieve and warns when RAG_CHAT_MODE is unknown', async () => {
      mockEnvs.RAG_CHAT_MODE = 'banana';

      const answer = await service.ask(opts);

      expect(answer.content).toBe('respuesta legacy');
      expect(orchestrator.ask).not.toHaveBeenCalled();
      expect(warn.mock.calls.flat().join(' ')).toContain('banana');
    });
  });
});
