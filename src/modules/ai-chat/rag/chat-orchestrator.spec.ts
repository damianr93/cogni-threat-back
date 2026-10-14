import { Logger } from '@nestjs/common';
import { ContextBudgetConfigError } from './context-budget';
import {
  ChatOrchestrator,
  NoToolCallsError,
  NO_ANSWER_MESSAGE,
  ToolExecutor,
} from './chat-orchestrator';
import { z } from 'zod';
import { ToolRegistry } from '../tools/tool-registry';
import { defineTool, limitOf } from '../tools/tool.types';

const VOSEO = /\b(tenés|podés|usá|respondé|decilo|sos|querés|probá|sabés)\b/i;

describe('ChatOrchestrator', () => {
  function makeOrchestrator(opts?: {
    maxToolSteps?: number;
    numCtx?: number;
    tools?: ToolExecutor;
    prefetch?: jest.Mock;
  }) {
    const chatWithTools = jest.fn();
    const tools: ToolExecutor = opts?.tools ?? {
      definitions: [
        {
          name: 'get_cve',
          description: 'Fetch one CVE by id.',
          parameters: { type: 'object' },
        },
      ],
      execute: jest
        .fn()
        .mockResolvedValue({ found: true, id: 'CVE-2024-3400' }),
    };
    const config = {
      getConfig: jest.fn().mockResolvedValue({
        maxToolSteps: opts?.maxToolSteps ?? 3,
        numCtx: opts?.numCtx ?? 8192,
        queryMaxChars: 2000,
      }),
    };
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const prefetch = opts?.prefetch ?? jest.fn().mockResolvedValue('');
    const orchestrator = new ChatOrchestrator(
      { chatWithTools } as never,
      tools,
      config as never,
      { prefetch } as never,
    );
    return { orchestrator, chatWithTools, tools, config, prefetch };
  }

  afterEach(() => jest.restoreAllMocks());

  const input = {
    question: '¿Qué es CVE-2024-3400?',
    history: [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'hola, ¿en qué te ayudo?' },
      { role: 'user', content: '¿Qué es CVE-2024-3400?' },
    ],
    categories: ['vuln-monitor'],
  };

  // No data intent, so a plain first answer is legitimate.
  const chitchat = {
    question: 'hola',
    history: [{ role: 'user', content: 'hola' }],
  };

  const toolCall = {
    content: '',
    toolCalls: [{ name: 'get_cve', arguments: { cveId: 'CVE-2024-3400' } }],
  };

  it('runs one tool and returns the following plain answer', async () => {
    const { orchestrator, chatWithTools, tools } = makeOrchestrator();
    chatWithTools
      .mockResolvedValueOnce(toolCall)
      .mockResolvedValueOnce({ content: 'Es una CVE crítica de PAN-OS.' });

    const result = await orchestrator.ask(input);

    expect(result).toEqual({
      content: 'Es una CVE crítica de PAN-OS.',
      toolSteps: 1,
      forcedClosure: false,
      toolsUsed: ['get_cve'],
    });
    expect(tools.execute).toHaveBeenCalledWith(
      { name: 'get_cve', arguments: { cveId: 'CVE-2024-3400' } },
      {
        categories: ['vuln-monitor'],
        sources: undefined,
        maxResultChars: 2500,
      },
    );
    const [secondTurn, secondTools] = chatWithTools.mock.calls[1];
    expect(secondTurn.slice(-2)).toEqual([
      {
        role: 'assistant',
        content:
          '<tool_call name="get_cve">{"cveId":"CVE-2024-3400"}</tool_call>',
      },
      {
        role: 'user',
        content:
          '<tool_result name="get_cve">{"found":true,"id":"CVE-2024-3400"}</tool_result>',
      },
    ]);
    expect(secondTools).toBe(tools.definitions);
  });

  it('signals NoToolCallsError when step 1 returns no tool call for a data question', async () => {
    const { orchestrator, chatWithTools } = makeOrchestrator();
    chatWithTools.mockResolvedValueOnce({ content: 'Creo que es una RCE.' });

    await expect(orchestrator.ask(input)).rejects.toBeInstanceOf(
      NoToolCallsError,
    );
    expect(chatWithTools).toHaveBeenCalledTimes(1);
  });

  it('accepts a plain answer after the first step even for a data question', async () => {
    const { orchestrator, chatWithTools } = makeOrchestrator();
    chatWithTools
      .mockResolvedValueOnce(toolCall)
      .mockResolvedValueOnce({ content: 'Respuesta.' });

    await expect(orchestrator.ask(input)).resolves.toMatchObject({
      content: 'Respuesta.',
    });
  });

  it('returns a direct answer with zero steps when the model calls no tool', async () => {
    const { orchestrator, chatWithTools, tools } = makeOrchestrator();
    chatWithTools.mockResolvedValueOnce({ content: 'Hola, ¿qué necesitas?' });

    const result = await orchestrator.ask(chitchat);

    expect(result).toEqual({
      content: 'Hola, ¿qué necesitas?',
      toolSteps: 0,
      forcedClosure: false,
      toolsUsed: [],
    });
    expect(tools.execute).not.toHaveBeenCalled();
  });

  it('forces a tool-less closing call once the step budget is spent', async () => {
    const { orchestrator, chatWithTools, tools } = makeOrchestrator({
      maxToolSteps: 2,
    });
    chatWithTools
      .mockResolvedValueOnce(toolCall)
      .mockResolvedValueOnce(toolCall)
      .mockResolvedValueOnce({ content: 'Respuesta final con lo obtenido.' });

    const result = await orchestrator.ask(input);

    expect(result).toEqual({
      content: 'Respuesta final con lo obtenido.',
      toolSteps: 2,
      forcedClosure: true,
      toolsUsed: ['get_cve', 'get_cve'],
    });
    expect(tools.execute).toHaveBeenCalledTimes(2);
    expect(chatWithTools).toHaveBeenCalledTimes(3);
    const [closingMessages, closingTools] = chatWithTools.mock.calls[2];
    expect(closingTools).toBeUndefined();
    expect(closingMessages[closingMessages.length - 1]).toMatchObject({
      role: 'user',
    });
    expect(closingMessages[closingMessages.length - 1].content).toMatch(
      /Responde ahora/,
    );
  });

  it('takes the step budget from the runtime config and trims extra calls in one response', async () => {
    const { orchestrator, chatWithTools, tools, config } = makeOrchestrator({
      maxToolSteps: 1,
    });
    chatWithTools
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { name: 'get_cve', arguments: { cveId: 'CVE-2024-0001' } },
          { name: 'get_cve', arguments: { cveId: 'CVE-2024-0002' } },
        ],
      })
      .mockResolvedValueOnce({ content: 'cierre' });

    const result = await orchestrator.ask(input);

    expect(config.getConfig).toHaveBeenCalled();
    expect(tools.execute).toHaveBeenCalledTimes(1);
    expect(result.toolSteps).toBe(1);
    expect(result.forcedClosure).toBe(true);
  });

  it('feeds executor failures back as an error result instead of throwing', async () => {
    const tools: ToolExecutor = {
      definitions: [],
      execute: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const { orchestrator, chatWithTools } = makeOrchestrator({ tools });
    chatWithTools
      .mockResolvedValueOnce(toolCall)
      .mockResolvedValueOnce({ content: 'No se pudo consultar.' });

    const result = await orchestrator.ask(input);

    expect(result.content).toBe('No se pudo consultar.');
    const fed = chatWithTools.mock.calls[1][0].slice(-1)[0];
    expect(fed.content).toBe(
      '<tool_result name="get_cve">{"error":"db down"}</tool_result>',
    );
  });

  it('answers an unknown tool with an error through an empty ToolRegistry and keeps looping', async () => {
    const { orchestrator, chatWithTools } = makeOrchestrator({
      tools: new ToolRegistry([]),
    });
    chatWithTools
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ name: 'drop_table', arguments: {} }],
      })
      .mockResolvedValueOnce({ content: 'No tengo esa herramienta.' });

    const result = await orchestrator.ask(input);

    expect(result.content).toBe('No tengo esa herramienta.');
    expect(chatWithTools.mock.calls[0][1]).toEqual([]);
    const fed = chatWithTools.mock.calls[1][0].slice(-1)[0].content;
    expect(fed).toContain('<tool_result name="drop_table">');
    expect(fed).toContain('Unknown tool: drop_table');
  });

  it('feeds validation errors from a real ToolRegistry back to the model without running the tool', async () => {
    const run = jest.fn();
    const registry = new ToolRegistry([
      defineTool({
        name: 'search_cves',
        description: 'Search CVEs.',
        parameters: { type: 'object', properties: { limit: {} } },
        schema: z.object({ limit: limitOf(10) }),
        run,
      }),
    ]);
    const { orchestrator, chatWithTools } = makeOrchestrator({
      tools: registry,
    });
    chatWithTools
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ name: 'search_cves', arguments: { limit: 'abc' } }],
      })
      .mockResolvedValueOnce({ content: 'Corregido.' });

    const result = await orchestrator.ask(input);

    expect(result.content).toBe('Corregido.');
    expect(run).not.toHaveBeenCalled();
    expect(chatWithTools.mock.calls[0][1]).toEqual(registry.definitions);
    expect(chatWithTools.mock.calls[1][0].slice(-1)[0].content).toContain(
      'Invalid arguments for search_cves',
    );
  });

  it('strips tool tags from the final text', async () => {
    const { orchestrator, chatWithTools } = makeOrchestrator();
    chatWithTools.mockResolvedValueOnce({
      content: '<tool_call name="get_cve">{}</tool_call>Respuesta limpia',
    });

    const result = await orchestrator.ask(chitchat);

    expect(result.content).toBe('{}Respuesta limpia');
  });

  it('falls back to the closing call, then to the no-answer message, on empty text', async () => {
    const { orchestrator, chatWithTools } = makeOrchestrator();
    chatWithTools
      .mockResolvedValueOnce({ content: '   ' })
      .mockResolvedValueOnce({ content: '' });

    const result = await orchestrator.ask(chitchat);

    expect(result.content).toBe(NO_ANSWER_MESSAGE);
    expect(result.forcedClosure).toBe(true);
    expect(chatWithTools).toHaveBeenCalledTimes(2);
    expect(NO_ANSWER_MESSAGE).not.toMatch(VOSEO);
  });

  it('builds a neutral Spanish system prompt and does not duplicate the current question', async () => {
    const { orchestrator, chatWithTools } = makeOrchestrator();
    chatWithTools.mockResolvedValueOnce({ content: 'ok' });

    await orchestrator.ask(chitchat);

    const messages = chatWithTools.mock.calls[0][0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toMatch(/Responde siempre en español/);
    expect(messages[0].content).not.toMatch(VOSEO);
    expect(
      messages.filter(
        (m: { content: string }) => m.content === chitchat.question,
      ),
    ).toHaveLength(1);
    expect(messages[messages.length - 1]).toEqual({
      role: 'user',
      content: chitchat.question,
    });
  });

  it('propagates provider errors so the caller can fall back', async () => {
    const { orchestrator, chatWithTools } = makeOrchestrator();
    chatWithTools.mockRejectedValue(new Error('ollama down'));

    await expect(orchestrator.ask(input)).rejects.toThrow('ollama down');
  });

  describe('context budget', () => {
    it('hands each tool a per-result cap derived from the remaining budget', async () => {
      const { orchestrator, chatWithTools, tools } = makeOrchestrator();
      chatWithTools
        .mockResolvedValueOnce(toolCall)
        .mockResolvedValueOnce({ content: 'listo' });

      await orchestrator.ask(input);

      const context = (tools.execute as jest.Mock).mock.calls[0][1];
      expect(context.maxResultChars).toBe(2500);
    });

    it('omits the oldest tool result instead of overflowing num_ctx', async () => {
      const big = jest.fn().mockResolvedValue({ pad: 'x'.repeat(6000) });
      const { orchestrator, chatWithTools } = makeOrchestrator({
        numCtx: 5024,
        tools: {
          definitions: [
            {
              name: 'get_cve',
              description: 'd',
              parameters: { type: 'object' },
            },
          ],
          execute: big,
        },
      });
      chatWithTools
        .mockResolvedValueOnce(toolCall)
        .mockResolvedValueOnce(toolCall)
        .mockResolvedValueOnce({ content: 'listo' });

      await orchestrator.ask(input);

      const third = chatWithTools.mock.calls[2][0] as Array<{
        content: string;
      }>;
      expect(third.some((m) => m.content.includes('context_budget'))).toBe(
        true,
      );
    });

    it('skips straight to a tool-less closing call when too little budget remains', async () => {
      const { orchestrator, chatWithTools, tools } = makeOrchestrator({
        numCtx: 1500,
      });
      chatWithTools.mockResolvedValueOnce({ content: 'cierre' });

      const result = await orchestrator.ask(input);

      expect(chatWithTools).toHaveBeenCalledTimes(1);
      expect(chatWithTools.mock.calls[0][1]).toBeUndefined();
      expect(tools.execute).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        content: 'cierre',
        forcedClosure: true,
        toolSteps: 0,
      });
    });

    it('fails fast with a config error when the system prompt and schemas do not fit', async () => {
      const { orchestrator, chatWithTools } = makeOrchestrator({
        numCtx: 1100,
      });

      await expect(orchestrator.ask(input)).rejects.toBeInstanceOf(
        ContextBudgetConfigError,
      );
      expect(chatWithTools).not.toHaveBeenCalled();
    });
  });

  describe('selected source prefetch', () => {
    const selected = {
      ...chitchat,
      sources: ['vuln-monitor:cve:CVE-2024-0001'],
      categories: ['vuln-monitor'],
    };

    it('puts the prefetched block in a CONTEXTO section before the question', async () => {
      const prefetch = jest.fn().mockResolvedValue('[vuln-monitor] block');
      const { orchestrator, chatWithTools } = makeOrchestrator({ prefetch });
      chatWithTools.mockResolvedValueOnce({ content: 'Respuesta.' });

      await orchestrator.ask(selected);

      const [turn] = chatWithTools.mock.calls[0];
      expect(turn[turn.length - 1]).toEqual({
        role: 'user',
        content: expect.stringMatching(
          /^CONTEXTO[^\n]*:\n\[vuln-monitor\] block\n\nPREGUNTA:\nhola$/,
        ),
      });
    });

    it('accepts a direct answer from the selected context instead of routing', async () => {
      const prefetch = jest.fn().mockResolvedValue('[vuln-monitor] block');
      const { orchestrator, chatWithTools } = makeOrchestrator({ prefetch });
      chatWithTools.mockResolvedValueOnce({ content: 'Según el contexto.' });

      await expect(
        orchestrator.ask({
          ...input,
          sources: ['vuln-monitor:cve:CVE-2024-3400'],
        }),
      ).resolves.toMatchObject({
        content: 'Según el contexto.',
        toolSteps: 0,
      });
    });

    it('runs prefetch tools with the UI scope and a positive budget', async () => {
      const prefetch = jest.fn().mockResolvedValue('');
      const { orchestrator, chatWithTools, tools } = makeOrchestrator({
        prefetch,
      });
      chatWithTools.mockResolvedValueOnce({ content: 'Hola.' });

      await orchestrator.ask(selected);

      const [sources, runTool, maxChars] = prefetch.mock.calls[0];
      expect(sources).toEqual(['vuln-monitor:cve:CVE-2024-0001']);
      expect(maxChars).toBeGreaterThan(1000);
      await runTool({ name: 'get_cve', arguments: { cveId: 'CVE-2024-0001' } });
      expect(tools.execute).toHaveBeenCalledWith(
        { name: 'get_cve', arguments: { cveId: 'CVE-2024-0001' } },
        expect.objectContaining({
          categories: ['vuln-monitor'],
          sources: ['vuln-monitor:cve:CVE-2024-0001'],
        }),
      );
    });

    it('leaves the question untouched without sources, with an empty block or on failure', async () => {
      const failing = jest.fn().mockRejectedValue(new Error('boom'));
      const empty = jest.fn().mockResolvedValue('');
      const none = jest.fn().mockResolvedValue('block');
      for (const [prefetch, sources] of [
        [failing, selected.sources],
        [empty, selected.sources],
        [none, undefined],
      ] as const) {
        const { orchestrator, chatWithTools } = makeOrchestrator({ prefetch });
        chatWithTools.mockResolvedValueOnce({ content: 'Hola.' });

        await orchestrator.ask({ ...selected, sources: sources as string[] });

        const [turn] = chatWithTools.mock.calls[0];
        expect(turn[turn.length - 1]).toEqual({
          role: 'user',
          content: 'hola',
        });
      }
      expect(none).not.toHaveBeenCalled();
    });

    it('skips the prefetch when no context budget is left for it', async () => {
      const prefetch = jest.fn().mockResolvedValue('block');
      const { orchestrator, chatWithTools } = makeOrchestrator({
        prefetch,
        numCtx: 2600,
      });
      chatWithTools.mockResolvedValueOnce({ content: 'Hola.' });

      await orchestrator.ask(selected);

      expect(prefetch).not.toHaveBeenCalled();
    });
  });
});
