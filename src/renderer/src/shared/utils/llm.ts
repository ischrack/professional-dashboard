import { api } from '../hooks/useApi'
import type { ChatMessage, LLMRequest } from '@shared/types'

export async function callLLM(
  provider: 'anthropic' | 'openai',
  model: string,
  messages: ChatMessage[],
  systemPrompt: string
): Promise<string> {
  const req: LLMRequest = { provider, model, messages, systemPrompt }
  const res = await api.llmCall(req as unknown as Record<string, unknown>) as { content: string }
  return res.content
}
