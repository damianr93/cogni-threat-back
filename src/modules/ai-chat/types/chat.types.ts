export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
}

export interface ConversationSummary {
  id: number;
  title: string;
  createdAt: string;
}

export interface ConversationRecord {
  id: number;
  userId: string;
  title: string;
  createdAt: Date;
  active: boolean;
  messages: ChatMessage[];
}

export interface ContextCategory {
  id: string;
  name: string;
  label: string;
  color: string;
}

export interface ContextSourceItem {
  id: string;
  label: string;
  category: string;
  summary?: string;
}

export interface ContextSourcesPage {
  items: ContextSourceItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (object type) describing the tool arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResult {
  content: string;
  toolCalls?: ToolCall[];
}

export type ChatVia = 'tools' | 'router' | 'retrieve';

export type DegradedReason =
  | 'model_without_tools'
  | 'no_tool_calls'
  | 'orchestrator_error';

/** Additive response metadata; clients that do not know it ignore it. */
export interface AskMeta {
  via: ChatVia;
  degraded: boolean;
  reason?: DegradedReason;
  tools?: string[];
}

export interface AskResponse {
  response: string;
  conversationId: number;
  timestamp: string;
  meta?: AskMeta;
}
