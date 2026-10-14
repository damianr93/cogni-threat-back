import { CveToolDeps, createCveTools } from './cve.tools';
import { ChatTool } from './tool.types';

/** Dependencies of every chat tool; later slices extend this with their own. */
export type ChatToolDeps = CveToolDeps;

/** Builds the full tool list for the `CHAT_TOOLS` token. */
export function buildChatTools(deps: ChatToolDeps): ChatTool[] {
  return [...createCveTools(deps)];
}
