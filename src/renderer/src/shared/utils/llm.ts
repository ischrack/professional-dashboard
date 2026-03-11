import { api } from '../hooks/useApi'
import type { ChatMessage, LLMProvider, LLMRequest } from '@shared/types'

/**
 * Infer the LLM provider from a model string.
 * OpenAI models start with 'gpt-', 'o1', or 'o3'.
 * Everything else is assumed to be Anthropic.
 */
export function inferProvider(model: string): 'anthropic' | 'openai' {
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  return 'anthropic'
}

export async function callLLM(
  provider: LLMProvider,
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  experienceLevel?: string
): Promise<string> {
  const req: LLMRequest = { provider, model, messages, systemPrompt, experienceLevel }
  const res = await api.llmCall(req as unknown as Record<string, unknown>) as { content: string }
  return res.content
}
