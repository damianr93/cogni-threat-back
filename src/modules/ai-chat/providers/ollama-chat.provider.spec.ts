import { Logger } from '@nestjs/common';
import axios from 'axios';
import {
  OllamaChatProvider,
  ToolsNotSupportedError,
} from './ollama-chat.provider';

jest.mock('axios');
const post = axios.post as jest.Mock;

const runtimeConfig = {
  ollamaUrl: 'http://ollama.test:11434',
  chatModel: 'gpt-oss',
  temperature: 0.2,
  numCtx: 8192,
  timeoutMs: 1234,
};

describe('OllamaChatProvider', () => {
  let getConfig: jest.Mock;
  let provider: OllamaChatProvider;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    getConfig = jest.fn().mockResolvedValue(runtimeConfig);
    provider = new OllamaChatProvider({ getConfig } as never);
  });

  const messages = [{ role: 'user', content: 'hola' }];
  const tools = [
    {
      name: 'get_cve',
      description: 'Fetch one CVE by id.',
      parameters: { type: 'object' },
    },
  ];

  describe('chat (legacy contract)', () => {
    it('posts without tools and returns the message text', async () => {
      post.mockResolvedValue({
        data: { message: { role: 'assistant', content: 'ok' } },
      });

      await expect(provider.chat(messages)).resolves.toBe('ok');

      const [url, body, opts] = post.mock.calls[0];
      expect(url).toBe('http://ollama.test:11434/api/chat');
      expect(body.tools).toBeUndefined();
      expect(body.model).toBe('gpt-oss');
      expect(opts).toEqual({ timeout: 1234 });
    });

    it('returns an empty string when the response has no message', async () => {
      post.mockResolvedValue({ data: {} });
      await expect(provider.chat(messages)).resolves.toBe('');
    });
  });

  describe('chatWithTools', () => {
    it('reads the runtime config and sends the tools array', async () => {
      post.mockResolvedValue({
        data: { message: { role: 'assistant', content: 'listo' } },
      });

      const result = await provider.chatWithTools(messages, tools);

      expect(getConfig).toHaveBeenCalledTimes(1);
      const [url, body, opts] = post.mock.calls[0];
      expect(url).toBe('http://ollama.test:11434/api/chat');
      expect(body).toMatchObject({
        model: 'gpt-oss',
        stream: false,
        options: { temperature: 0.2, num_ctx: 8192, repeat_penalty: 1.1 },
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_cve',
              description: 'Fetch one CVE by id.',
              parameters: { type: 'object' },
            },
          },
        ],
      });
      expect(opts).toEqual({ timeout: 1234 });
      expect(result).toEqual({ content: 'listo', toolCalls: undefined });
    });

    it('omits the tools field when none are given', async () => {
      post.mockResolvedValue({
        data: { message: { role: 'assistant', content: 'x' } },
      });

      await provider.chatWithTools(messages);

      expect(post.mock.calls[0][1].tools).toBeUndefined();
    });

    it('parses tool_calls into typed calls (object and JSON-string arguments)', async () => {
      post.mockResolvedValue({
        data: {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                function: {
                  name: 'get_cve',
                  arguments: { cveId: 'CVE-2024-3400' },
                },
              },
              { function: { name: 'cve_stats', arguments: '{"a":1}' } },
            ],
          },
        },
      });

      const result = await provider.chatWithTools(messages, tools);

      expect(result.toolCalls).toEqual([
        { name: 'get_cve', arguments: { cveId: 'CVE-2024-3400' } },
        { name: 'cve_stats', arguments: { a: 1 } },
      ]);
    });

    it('surfaces a typed error on HTTP 400 "does not support tools"', async () => {
      post.mockRejectedValue({
        message: 'Request failed with status code 400',
        response: {
          status: 400,
          data: {
            error: 'registry.ollama.ai/library/llama2 does not support tools',
          },
        },
      });

      await expect(
        provider.chatWithTools(messages, tools),
      ).rejects.toBeInstanceOf(ToolsNotSupportedError);
    });

    it('rethrows other 400 errors and other failures untouched', async () => {
      const badRequest = {
        message: 'bad',
        response: { status: 400, data: { error: 'invalid message format' } },
      };
      post.mockRejectedValueOnce(badRequest);
      await expect(provider.chatWithTools(messages, tools)).rejects.toBe(
        badRequest,
      );

      const timeout = new Error('timeout of 1234ms exceeded');
      post.mockRejectedValueOnce(timeout);
      await expect(provider.chatWithTools(messages, tools)).rejects.toBe(
        timeout,
      );
    });
  });
});
