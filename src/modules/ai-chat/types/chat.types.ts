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

export interface AskResponse {
  response: string;
  conversationId: number;
  timestamp: string;
}
