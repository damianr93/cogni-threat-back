import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ToolContext, ToolExecutor } from '../rag/chat-orchestrator';
import { ToolCall, ToolDefinition } from '../types/chat.types';
import { fitResult, ToolResult } from './fit-result';
import { CHAT_TOOLS, ChatTool } from './tool.types';

/**
 * Read-only tool registry driven by the orchestrator. Validation, unknown
 * tools, tool failures and oversized results all resolve to a value the model
 * can read (`{ error }` or a truncated result); `execute` never throws.
 * Concrete tools are provided through the `CHAT_TOOLS` token.
 */
@Injectable()
export class ToolRegistry implements ToolExecutor {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly byName = new Map<string, ChatTool>();
  readonly definitions: ToolDefinition[];

  constructor(@Optional() @Inject(CHAT_TOOLS) tools: ChatTool[] = []) {
    for (const tool of tools) {
      if (this.byName.has(tool.name)) {
        throw new Error(`Duplicate chat tool name: ${tool.name}`);
      }
      this.byName.set(tool.name, tool);
    }
    this.definitions = tools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters: { ...parameters },
    }));
  }

  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const tool = this.byName.get(call.name);
    if (!tool) {
      const available = [...this.byName.keys()].join(', ') || 'none';
      return { error: `Unknown tool: ${call.name}. Available: ${available}` };
    }

    const parsed = tool.schema.safeParse(call.arguments ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || 'args'}: ${i.message}`)
        .join('; ');
      return { error: `Invalid arguments for ${call.name}: ${issues}` };
    }

    try {
      const result = await tool.run(parsed.data as never, context);
      return fitResult(result, context.maxResultChars);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`tool ${call.name} failed: ${message}`);
      return { error: `Tool ${call.name} failed.` };
    }
  }
}
