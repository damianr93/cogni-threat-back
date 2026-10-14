import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { jsonSchemaMismatches } from './schema-parity';
import { ToolRegistry } from './tool-registry';
import { ChatTool, defineTool, limitOf, MAX_TOOL_LIMIT } from './tool.types';

const searchSchema = z.object({
  query: z.string().trim().max(200).optional(),
  severity: z.enum(['LOW', 'HIGH']),
  limit: limitOf(10),
});

function makeSearchTool(run = jest.fn().mockResolvedValue({ items: [] })) {
  const tool = defineTool({
    name: 'search_things',
    description: 'Search things.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        severity: { type: 'string', enum: ['LOW', 'HIGH'] },
        limit: { type: 'number' },
      },
      required: ['severity'],
    },
    schema: searchSchema,
    run,
  });
  return { tool, run };
}

const call = (name: string, args: Record<string, unknown>) => ({
  name,
  arguments: args,
});

describe('ToolRegistry', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('advertises exactly the registered tools, in order', () => {
    const { tool } = makeSearchTool();
    const other = defineTool({
      name: 'other_tool',
      description: 'Other.',
      parameters: { type: 'object', properties: {} },
      schema: z.object({}),
      run: jest.fn(),
    });

    const registry = new ToolRegistry([tool, other]);

    expect(registry.definitions.map((d) => d.name)).toEqual([
      'search_things',
      'other_tool',
    ]);
    expect(registry.definitions[0]).toEqual({
      name: 'search_things',
      description: 'Search things.',
      parameters: tool.parameters,
    });
  });

  it('works with an empty registry: no definitions, every call is an error', async () => {
    const registry = new ToolRegistry([]);

    expect(registry.definitions).toEqual([]);
    await expect(registry.execute(call('get_cve', {}), {})).resolves.toEqual({
      error: expect.stringContaining('Unknown tool: get_cve'),
    });
  });

  it('rejects duplicate tool names at construction', () => {
    const { tool } = makeSearchTool();
    expect(() => new ToolRegistry([tool, tool])).toThrow(/duplicate/i);
  });

  it('returns { error } naming an unknown tool and lists the available ones', async () => {
    const { tool, run } = makeSearchTool();
    const registry = new ToolRegistry([tool]);

    const result = await registry.execute(call('drop_table', {}), {});

    expect(result).toEqual({
      error: expect.stringMatching(/Unknown tool: drop_table.*search_things/),
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('returns { error } for invalid args without running the tool', async () => {
    const { tool, run } = makeSearchTool();
    const registry = new ToolRegistry([tool]);

    const result = await registry.execute(
      call('search_things', { severity: 'HIGH', limit: 'abc' }),
      {},
    );

    expect(result).toEqual({
      error: expect.stringMatching(
        /Invalid arguments for search_things.*limit/,
      ),
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a missing required argument', async () => {
    const { tool, run } = makeSearchTool();
    const result = await new ToolRegistry([tool]).execute(
      call('search_things', {}),
      {},
    );
    expect(result).toEqual({
      error: expect.stringMatching(/severity/),
    });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    [500, MAX_TOOL_LIMIT],
    [7, 7],
    [0, 1],
    [undefined, 10],
    ['12', 12],
  ])('passes limit %p to the tool as %p', async (input, expected) => {
    const { tool, run } = makeSearchTool();
    const registry = new ToolRegistry([tool]);

    await registry.execute(
      call('search_things', { severity: 'LOW', limit: input }),
      {},
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'LOW', limit: expected }),
      {},
    );
  });

  it('forwards the UI context to the tool', async () => {
    const { tool, run } = makeSearchTool();
    const ctx = { categories: ['actors'], sources: ['actor:1'] };

    await new ToolRegistry([tool]).execute(
      call('search_things', { severity: 'LOW' }),
      ctx,
    );

    expect(run).toHaveBeenCalledWith(expect.anything(), ctx);
  });

  it('fits oversized results to the context cap', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      note: 'x'.repeat(80),
    }));
    const { tool } = makeSearchTool(jest.fn().mockResolvedValue({ items }));
    const registry = new ToolRegistry([tool]);

    const result = await registry.execute(
      call('search_things', { severity: 'LOW' }),
      { maxResultChars: 700 },
    );

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(700);
    expect(result.truncated).toBe(true);
  });

  it('converts a throwing tool into { error } without leaking the cause', async () => {
    const { tool } = makeSearchTool(
      jest.fn().mockRejectedValue(new Error('connection to db-prod:5432 lost')),
    );
    const result = await new ToolRegistry([tool]).execute(
      call('search_things', { severity: 'LOW' }),
      {},
    );

    expect(result).toEqual({ error: 'Tool search_things failed.' });
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('connection to db-prod:5432 lost'),
    );
  });
});

describe('jsonSchemaMismatches (zod / JSON schema parity)', () => {
  const tool = makeSearchTool().tool;

  it('reports nothing when keys and required fields agree', () => {
    expect(jsonSchemaMismatches(tool)).toEqual([]);
  });

  it('reports a property missing from the JSON schema', () => {
    const drifted: ChatTool = {
      ...tool,
      parameters: {
        type: 'object',
        properties: { query: {}, severity: {} },
        required: ['severity'],
      },
    };
    expect(jsonSchemaMismatches(drifted)).toEqual([
      'properties differ: zod=[limit,query,severity] json=[query,severity]',
    ]);
  });

  it('reports a wrong required list', () => {
    const drifted: ChatTool = {
      ...tool,
      parameters: { ...tool.parameters, required: ['query'] },
    };
    expect(jsonSchemaMismatches(drifted)).toEqual([
      'required differ: zod=[severity] json=[query]',
    ]);
  });
});
