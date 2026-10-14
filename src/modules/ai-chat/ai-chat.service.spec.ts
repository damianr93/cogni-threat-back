import { AiChatService } from './ai-chat.service';
import type { AiRuntimeConfig } from './ai-config.service';
import type { ToolSupport } from './capability/model-capability.service';

function baseConfig(over: Partial<AiRuntimeConfig> = {}): AiRuntimeConfig {
  return {
    ollamaUrl: 'http://ollama.test:11434',
    chatModel: 'gpt-oss',
    embeddingModel: 'qwen3-embedding',
    timeoutMs: 1000,
    retrieveCandidates: 8,
    temperature: 0.2,
    numCtx: 8192,
    queryMaxChars: 3500,
    queryInstruct: 'q',
    chatMode: 'retrieve',
    maxToolSteps: 3,
    ...over,
  };
}

function build(config: AiRuntimeConfig, support: ToolSupport) {
  const getToolSupport = jest.fn().mockResolvedValue(support);
  const list = jest.fn();
  const service = new AiChatService(
    {} as never,
    {} as never,
    {} as never,
    { getConfig: jest.fn().mockResolvedValue(config) } as never,
    { getToolSupport } as never,
    { list } as never,
  );
  return { service, getToolSupport, list };
}

describe('AiChatService.getHealth', () => {
  it('keeps the existing fields unchanged', async () => {
    const { service } = build(baseConfig(), 'supported');
    const { success, data } = await service.getHealth();
    expect(success).toBe(true);
    expect(data).toMatchObject({
      status: 'ok',
      llm: 'ollama',
      rag: 'pgvector',
      ollamaUrl: 'http://ollama.test:11434',
      model: 'gpt-oss',
      embeddingModel: 'qwen3-embedding',
    });
  });

  it('reports retrieve mode as unknown tool calling without probing Ollama', async () => {
    const { service, getToolSupport } = build(baseConfig(), 'supported');
    const { data } = await service.getHealth();
    expect(data).toMatchObject({
      chatMode: 'retrieve',
      toolCalling: 'unknown',
      chatVia: 'retrieve',
      maxToolSteps: 3,
      numCtx: 8192,
    });
    expect(getToolSupport).not.toHaveBeenCalled();
  });

  it.each([
    ['supported', 'tools'],
    ['unknown', 'tools'],
    ['unsupported', 'router'],
  ] as const)(
    'tools mode with %s tool calling goes via %s',
    async (support, via) => {
      const { service } = build(
        baseConfig({ chatMode: 'tools', maxToolSteps: 5, numCtx: 16384 }),
        support,
      );
      const { data } = await service.getHealth();
      expect(data).toMatchObject({
        chatMode: 'tools',
        toolCalling: support,
        chatVia: via,
        maxToolSteps: 5,
        numCtx: 16384,
      });
    },
  );
});

describe('AiChatService.getContextSources', () => {
  it('delegates the sidebar search to the context sources service', async () => {
    const { service, list } = build(baseConfig(), 'supported');
    const page = {
      items: [{ id: 'telegram:channel:c1', label: 'c1', category: 'telegram' }],
      total: 1,
      page: 2,
      limit: 10,
      totalPages: 1,
    };
    list.mockResolvedValue(page);

    const out = await service.getContextSources(2, 10, 'c1', 'telegram');

    expect(list).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      search: 'c1',
      category: 'telegram',
    });
    expect(out).toBe(page);
  });
});
