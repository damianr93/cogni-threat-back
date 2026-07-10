import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AiConfigService } from '../ai-config.service';

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
}

interface OllamaChatResponse {
  message: { role: string; content: string };
}

@Injectable()
export class OllamaChatProvider {
  private readonly logger = new Logger(OllamaChatProvider.name);

  constructor(private readonly config: AiConfigService) {}

  async chat(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
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
    };

    try {
      const response = await axios.post<OllamaChatResponse>(
        `${config.ollamaUrl}/api/chat`,
        body,
        { timeout: config.timeoutMs },
      );
      return response.data.message?.content ?? '';
    } catch (error: any) {
      this.logger.error(`Ollama chat error: ${error?.message}`);
      throw error;
    }
  }
}
