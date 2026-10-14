import {
  stripToolTags,
  toToolCallMessage,
  toToolCalls,
  toToolResultMessage,
  toWireTools,
} from './tool-wire';

describe('tool-wire', () => {
  describe('toToolCallMessage', () => {
    it('re-feeds a call as an assistant message with a named tag', () => {
      expect(
        toToolCallMessage({
          name: 'get_cve',
          arguments: { cveId: 'CVE-2024-3400' },
        }),
      ).toEqual({
        role: 'assistant',
        content:
          '<tool_call name="get_cve">{"cveId":"CVE-2024-3400"}</tool_call>',
      });
    });

    it('serialises empty arguments as an empty object', () => {
      expect(toToolCallMessage({ name: 'cve_stats', arguments: {} })).toEqual({
        role: 'assistant',
        content: '<tool_call name="cve_stats">{}</tool_call>',
      });
    });
  });

  describe('toToolResultMessage', () => {
    it('re-feeds a result as a user message with a named tag', () => {
      expect(toToolResultMessage('get_cve', { found: true, id: 'X' })).toEqual({
        role: 'user',
        content:
          '<tool_result name="get_cve">{"found":true,"id":"X"}</tool_result>',
      });
    });

    it('wraps error results the same way', () => {
      expect(
        toToolResultMessage('drop_table', { error: 'Unknown tool' }),
      ).toEqual({
        role: 'user',
        content:
          '<tool_result name="drop_table">{"error":"Unknown tool"}</tool_result>',
      });
    });
  });

  describe('stripToolTags', () => {
    it('removes call and result tags but keeps the text between them', () => {
      expect(
        stripToolTags(
          'Antes <tool_call name="a">{"x":1}</tool_call> despues <tool_result name="a">{}</tool_result>',
        ),
      ).toBe('Antes {"x":1} despues {}');
    });

    it('trims and tolerates null or undefined', () => {
      expect(stripToolTags('  hola  ')).toBe('hola');
      expect(stripToolTags(undefined)).toBe('');
      expect(stripToolTags(null)).toBe('');
    });
  });

  describe('toToolCalls', () => {
    it('parses JSON-string arguments', () => {
      expect(
        toToolCalls([
          {
            function: {
              name: 'get_cve',
              arguments: '{"cveId":"CVE-2024-3400"}',
            },
          },
        ]),
      ).toEqual([{ name: 'get_cve', arguments: { cveId: 'CVE-2024-3400' } }]);
    });

    it('accepts object arguments as sent by Ollama', () => {
      expect(
        toToolCalls([{ function: { name: 'cve_stats', arguments: { a: 1 } } }]),
      ).toEqual([{ name: 'cve_stats', arguments: { a: 1 } }]);
    });

    it('keeps unparseable or non-object strings under raw', () => {
      expect(
        toToolCalls([{ function: { name: 'x', arguments: '{bad' } }]),
      ).toEqual([{ name: 'x', arguments: { raw: '{bad' } }]);
      expect(
        toToolCalls([{ function: { name: 'x', arguments: '[1,2]' } }]),
      ).toEqual([{ name: 'x', arguments: { raw: '[1,2]' } }]);
    });

    it('drops calls without a name and returns undefined when nothing is left', () => {
      expect(toToolCalls([{ function: { arguments: '{}' } }])).toBeUndefined();
      expect(toToolCalls([])).toBeUndefined();
      expect(toToolCalls(undefined)).toBeUndefined();
    });

    it('defaults missing arguments to an empty object', () => {
      expect(toToolCalls([{ function: { name: 'cve_stats' } }])).toEqual([
        { name: 'cve_stats', arguments: {} },
      ]);
    });
  });

  describe('toWireTools', () => {
    it('wraps definitions as function tools', () => {
      expect(
        toWireTools([
          { name: 'a', description: 'd', parameters: { type: 'object' } },
        ]),
      ).toEqual([
        {
          type: 'function',
          function: {
            name: 'a',
            description: 'd',
            parameters: { type: 'object' },
          },
        },
      ]);
    });

    it('omits the field entirely when there are no tools', () => {
      expect(toWireTools(undefined)).toBeUndefined();
      expect(toWireTools([])).toBeUndefined();
    });
  });
});
