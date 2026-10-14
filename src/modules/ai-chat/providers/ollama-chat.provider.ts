import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AiConfigService } from '../ai-config.service';
import { ChatResult, ToolDefinition } from '../types/chat.types';
import { toToolCalls, toWireTools, WireTool, WireToolCall } from './tool-wire';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatBody {
  model: string;
  messages: OllamaMessage[];
  stream: false;
  options: {
    temperature: number;
    num_ctx: number;
    repeat_penalty: number;
  };
  tools?: WireTool[];
}

interface OllamaChatResponse {
  message: { role: string; content: string; tool_calls?: WireToolCall[] };
}

const TOOLS_UNSUPPORTED = /does not support tools/i;

/** Ollama rejected the request because the configured model has no tool support. */
export class ToolsNotSupportedError extends Error {
  constructor(readonly model: string) {
    super(`Model ${model} does not support tools`);
    this.name = 'ToolsNotSupportedError';
  }
}

interface HttpErrorLike {
  response?: { status?: number; data?: unknown };
}

function isToolsUnsupportedResponse(error: unknown): boolean {
  const response = (error as HttpErrorLike | null)?.response;
  if (response?.status !== 400) return false;
  const data = response.data;
  const payload =
    typeof data === 'string'
      ? data
      : (data as { error?: unknown } | null)?.error;
  const text = typeof payload === 'string' ? payload : JSON.stringify(data);
  return TOOLS_UNSUPPORTED.test(text);
}

@Injectable()
export class OllamaChatProvider {
  private readonly logger = new Logger(OllamaChatProvider.name);

  constructor(private readonly config: AiConfigService) {}

  async chat(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const result = await this.chatWithTools(messages);
    return result.content;
  }

  /** Same call as `chat`, optionally advertising tools and returning the model tool calls. */
  async chatWithTools(
    messages: Array<{ role: string; content: string }>,
    tools?: ToolDefinition[],
  ): Promise<ChatResult> {
    const config = await this.config.getConfig();
    const body: OllamaChatBody = {
      model: config.chatModel,
      messages: messages.map((m) => ({
        role: m.role as OllamaMessage['role'],
        content: m.content,
      })),
      stream: false,
      options: {
        temperature: config.temperature,
        num_ctx: config.numCtx,
        repeat_penalty: 1.1,
      },
      tools: toWireTools(tools),
    };

    try {
      const response = await axios.post<OllamaChatResponse>(
        `${config.ollamaUrl}/api/chat`,
        body,
        { timeout: config.timeoutMs },
      );
      return {
        content: response.data.message?.content ?? '',
        toolCalls: toToolCalls(response.data.message?.tool_calls),
      };
    } catch (error: unknown) {
      this.logger.error(
        `Ollama chat error: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (isToolsUnsupportedResponse(error)) {
        throw new ToolsNotSupportedError(config.chatModel);
      }
      throw error;
    }
  }
}
