import { Logger } from '@nestjs/common';
import { AiConfigService } from './ai-config.service';

const mockEnvs = {
  OLLAMA_URL: 'http://ollama.test:11434/',
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

describe('AiConfigService chat mode', () => {
  let warn: jest.SpyInstance;
  let service: AiConfigService;

  beforeEach(() => {
    mockEnvs.RAG_CHAT_MODE = 'retrieve';
    mockEnvs.RAG_CHAT_MAX_TOOL_STEPS = 3;
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    service = new AiConfigService({
      get: jest.fn().mockResolvedValue(null),
    } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('keeps retrieve when configured, with 3 tool steps and no warning', async () => {
    const config = await service.getConfig();

    expect(config.chatMode).toBe('retrieve');
    expect(config.maxToolSteps).toBe(3);
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts tools and a custom step budget from the environment', async () => {
    mockEnvs.RAG_CHAT_MODE = 'tools';
    mockEnvs.RAG_CHAT_MAX_TOOL_STEPS = 5;

    const config = await service.getConfig();

    expect(config.chatMode).toBe('tools');
    expect(config.maxToolSteps).toBe(5);
  });

  it('normalises case and surrounding whitespace', async () => {
    mockEnvs.RAG_CHAT_MODE = ' Tools ';
    expect((await service.getConfig()).chatMode).toBe('tools');
  });

  it('falls back to the default tools mode and warns once on an invalid value', async () => {
    mockEnvs.RAG_CHAT_MODE = 'banana';

    expect((await service.getConfig()).chatMode).toBe('tools');
    expect((await service.getConfig()).chatMode).toBe('tools');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('banana');
    expect(warn.mock.calls[0][0]).toContain('using "tools"');
  });
});
