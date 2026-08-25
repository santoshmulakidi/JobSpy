import type { CopilotMessage } from '../providers/llm/types';

const CHARACTERS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 4;

/** A conservative, provider-neutral estimate used only for deterministic trimming. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN);
}

export function estimateMessageTokens(messages: readonly CopilotMessage[]): number {
  return messages.reduce(
    (total, message) => total + MESSAGE_OVERHEAD_TOKENS + estimateTokens(message.role) + estimateTokens(message.content),
    0,
  );
}
