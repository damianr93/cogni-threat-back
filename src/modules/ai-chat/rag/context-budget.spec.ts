import { toToolCallMessage, toToolResultMessage } from '../providers/tool-wire';
import { LlmMessage, ToolDefinition } from '../types/chat.types';
import {
  ContextBudgetConfigError,
  estimateTokens,
  fitContext,
  prefetchBudgetChars,
} from './context-budget';

const msg = (
  role: LlmMessage['role'],
  chars: number,
  mark = role,
): LlmMessage => ({ role, content: mark.padEnd(chars, '.') });

const toolWith = (descriptionChars: number): ToolDefinition => ({
  name: 'get_cve',
  description: 'd'.repeat(descriptionChars),
  parameters: { type: 'object' },
});

const call = toToolCallMessage({ name: 'get_cve', arguments: { id: 'x' } });
const result = (chars: number, name = 'get_cve') =>
  toToolResultMessage(name, { pad: 'r'.repeat(chars) });

const OMITTED = (name: string) =>
  `<tool_result name="${name}">{"omitted":"context_budget"}</tool_result>`;

const opts = (numCtx: number, turnStart: number) => ({
  numCtx,
  queryMaxChars: 100,
  turnStart,
});

describe('estimateTokens', () => {
  it('uses ceil(chars/3) + 4 per message', () => {
    expect(estimateTokens([msg('user', 6), msg('user', 7)])).toBe(6 + 7);
  });

  it('adds the serialized tool schemas', () => {
    const tools = [toolWith(100)];
    const schemaChars = JSON.stringify(tools).length;
    expect(estimateTokens([msg('user', 6)], tools)).toBe(
      6 + Math.ceil(schemaChars / 3),
    );
  });
});

describe('fitContext', () => {
  it('returns the same messages and tools when everything fits', () => {
    const messages = [msg('system', 300), msg('user', 30)];
    const tools = [toolWith(10)];

    const fit = fitContext(messages, tools, opts(8192, 1));

    expect(fit.messages).toEqual(messages);
    expect(fit.tools).toBe(tools);
    expect(fit.forceClosure).toBe(false);
    expect(fit.resultCap).toBe(2500);
  });

  describe('per-result cap', () => {
    // system 300 chars (104) + question 30 chars (14) = 118 tokens
    const messages = [msg('system', 300), msg('user', 30)];

    it('is floor(remaining * 3 * 0.6) inside the 600..2500 range', () => {
      const fit = fitContext(messages, undefined, opts(1024 + 118 + 1000, 1));
      expect(fit.resultCap).toBe(1800);
      expect(fit.forceClosure).toBe(false);
    });

    it('differs with a different remaining budget', () => {
      const fit = fitContext(messages, undefined, opts(1024 + 118 + 1500, 1));
      expect(fit.resultCap).toBe(2500);
    });
  });

  describe('forced closure', () => {
    const messages = [msg('system', 300), msg('user', 30)];

    it('is forced and drops tools when fewer than 900 tokens remain', () => {
      const fit = fitContext(
        messages,
        [toolWith(10)],
        opts(1024 + 118 + 120 + 800, 1),
      );
      expect(fit.forceClosure).toBe(true);
      expect(fit.tools).toBeUndefined();
      expect(fit.messages[0]).toEqual(messages[0]);
      expect(fit.messages).toEqual(messages);
    });

    it('stays off at exactly 900 remaining', () => {
      const tools = [toolWith(10)];
      const toolTokens = estimateTokens([], tools);
      const fit = fitContext(
        messages,
        tools,
        opts(1024 + 118 + toolTokens + 900, 1),
      );
      expect(fit.forceClosure).toBe(false);
      expect(fit.tools).toBe(tools);
    });
  });

  describe('trim order (numCtx 4096, 3072 available)', () => {
    it('drops the oldest history first', () => {
      const system = msg('system', 30);
      const messages = [
        system,
        msg('user', 7000, 'h1'),
        msg('assistant', 3000, 'h2'),
        msg('user', 30, 'q'),
      ];

      const fit = fitContext(messages, undefined, opts(4096, 3));

      expect(fit.messages).toEqual([system, messages[2], messages[3]]);
      expect(fit.forceClosure).toBe(false);
    });

    it('keeps dropping history one message at a time until it fits', () => {
      const messages = [
        msg('system', 30),
        msg('user', 5000, 'h1'),
        msg('assistant', 5000, 'h2'),
        msg('user', 5000, 'h3'),
        msg('user', 30, 'q'),
      ];

      const fit = fitContext(messages, undefined, opts(4096, 4));

      expect(fit.messages).toEqual([messages[0], messages[3], messages[4]]);
    });

    it('drops history before touching tool results', () => {
      const messages = [
        msg('system', 30),
        msg('user', 5000, 'h1'),
        msg('user', 30, 'q'),
        call,
        result(5000),
      ];

      const fit = fitContext(messages, undefined, opts(4096, 2));

      expect(fit.messages).toEqual([messages[0], ...messages.slice(2)]);
    });

    it('omits the oldest tool result bodies when there is no history to drop', () => {
      const first = result(6000, 'search_cves');
      const second = result(3000);
      const messages = [
        msg('system', 30),
        msg('user', 30, 'q'),
        call,
        first,
        call,
        second,
      ];

      const fit = fitContext(messages, undefined, opts(4096, 1));

      expect(fit.messages[3].content).toBe(OMITTED('search_cves'));
      expect(fit.messages[5]).toEqual(second);
      expect(fit.messages[2]).toEqual(call);
      expect(fit.forceClosure).toBe(false);
    });

    it('forces closure without tools when schemas keep it over budget', () => {
      const tools = [toolWith(9000)];
      const messages = [
        msg('system', 30),
        msg('user', 30, 'q'),
        call,
        result(5000),
      ];

      const fit = fitContext(messages, tools, opts(4096, 1));

      expect(fit.forceClosure).toBe(true);
      expect(fit.tools).toBeUndefined();
      expect(fit.messages[3].content).toBe(OMITTED('get_cve'));
      expect(fit.messages[0]).toEqual(messages[0]);
    });

    it('truncates the question to queryMaxChars only as the last resort', () => {
      const messages = [
        msg('system', 30),
        { role: 'user', content: 'q'.repeat(20000) } as LlmMessage,
      ];

      const fit = fitContext(messages, undefined, opts(4096, 1));

      expect(fit.forceClosure).toBe(true);
      expect(fit.messages[1].content).toBe('q'.repeat(100));
      expect(fit.messages[0]).toEqual(messages[0]);
    });
  });

  describe('fixed prompt and schemas', () => {
    it('fails fast with a config error when the schemas do not fit', () => {
      const messages = [msg('system', 300), msg('user', 30)];
      expect(() =>
        fitContext(messages, [toolWith(9000)], opts(2048, 1)),
      ).toThrow(ContextBudgetConfigError);
      expect(() =>
        fitContext(messages, [toolWith(9000)], opts(2048, 1)),
      ).toThrow(/schemas/i);
    });

    it('fails fast when the system prompt alone does not fit', () => {
      const messages = [msg('system', 9000), msg('user', 30)];
      expect(() => fitContext(messages, undefined, opts(2048, 1))).toThrow(
        ContextBudgetConfigError,
      );
    });
  });
});

describe('fitContext keeps room for another tool round', () => {
  it('trims more history instead of forcing closure when that frees a round', () => {
    const system = msg('system', 3000);
    const question = msg('user', 30, 'question');
    const messages = [
      system,
      msg('user', 4500, 'old-1'),
      msg('assistant', 17100, 'old-2'),
      question,
    ];
    const tools = [toolWith(10)];

    const fit = fitContext(messages, tools, opts(8192, 3));

    expect(fit.forceClosure).toBe(false);
    expect(fit.tools).toBe(tools);
    expect(fit.messages).toEqual([system, question]);
  });
});

describe('prefetchBudgetChars', () => {
  it('offers half of the spare tokens once the answer and a tool round are reserved', () => {
    // 300-char system + 100-char question: 104 + 38 tokens used.
    const messages = [msg('system', 300), msg('user', 100)];
    const spare = 8192 - 1024 - 900 - estimateTokens(messages);

    expect(prefetchBudgetChars(messages, undefined, 8192)).toBe(
      Math.floor(spare * 3 * 0.5),
    );
  });

  it('shrinks with the tool schemas and reaches zero instead of going negative', () => {
    const messages = [msg('system', 300), msg('user', 100)];
    const bare = prefetchBudgetChars(messages, undefined, 8192);

    expect(prefetchBudgetChars(messages, [toolWith(3000)], 8192)).toBeLessThan(
      bare,
    );
    expect(prefetchBudgetChars(messages, [toolWith(30000)], 8192)).toBe(0);
  });

  it('leaves a prompt that fitContext keeps intact and still offering tools', () => {
    const messages = [msg('system', 300), msg('user', 100)];
    const tools = [toolWith(2000)];
    const budget = prefetchBudgetChars(messages, tools, 8192);
    const withBlock = [
      messages[0],
      { ...messages[1], content: 'c'.repeat(budget) + messages[1].content },
    ];

    const fit = fitContext(withBlock, tools, opts(8192, 1));

    expect(budget).toBeGreaterThan(1000);
    expect(fit.forceClosure).toBe(false);
    expect(fit.messages).toEqual(withBlock);
  });
});
