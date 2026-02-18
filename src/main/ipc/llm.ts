import { ipcMain } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { IPC } from '../../shared/types'
import type { LLMRequest, LLMResponse, ChatMessage } from '../../shared/types'
import { getEncryptedKey } from './settings'

const CONTEXT_COMPRESS_THRESHOLD = 0.8 // compress at 80% of context limit

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-6': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
}

function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 chars
  return Math.ceil(text.length / 4)
}

function getContextLimit(model: string): number {
  return MODEL_CONTEXT_LIMITS[model] || 128000
}

function totalTokensInMessages(messages: ChatMessage[], systemPrompt: string): number {
  const allText = systemPrompt + messages.map((m) => m.content).join('')
  return estimateTokens(allText)
}

async function summarizeConversation(
  provider: string,
  model: string,
  messages: ChatMessage[],
  apiKey: string
): Promise<string> {
  const summaryPrompt: ChatMessage[] = [
    ...messages,
    {
      role: 'user',
      content: 'Please provide a concise summary of our conversation so far, including the main versions of the post and the key revisions requested.',
    },
  ]
  const result = await callLLMDirect(provider, model, summaryPrompt, 'You are a helpful assistant.', apiKey)
  return result.content
}

async function callLLMDirect(
  provider: string,
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  apiKey: string
): Promise<LLMResponse> {
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    })
    return {
      content: response.content[0].type === 'text' ? response.content[0].text : '',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }
  } else {
    const client = new OpenAI({ apiKey })
    const response = await client.chat.completions.create({
      model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
      ],
    })
    return {
      content: response.choices[0]?.message?.content || '',
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    }
  }
}

export function registerLlmHandlers(): void {
  ipcMain.handle(IPC.LLM_CALL, async (_evt, req: LLMRequest): Promise<LLMResponse> => {
    const keyName = req.provider === 'anthropic' ? 'anthropicKey' : 'openaiKey'
    const apiKey = getEncryptedKey(keyName)

    if (!apiKey) {
      throw new Error(`No ${req.provider} API key configured. Please add your key in Settings.`)
    }

    let messages = [...req.messages]
    const contextLimit = getContextLimit(req.model)
    const totalTokens = totalTokensInMessages(messages, req.systemPrompt)

    // Compress if approaching context limit
    if (totalTokens > contextLimit * CONTEXT_COMPRESS_THRESHOLD && messages.length > 4) {
      try {
        const summary = await summarizeConversation(req.provider, req.model, messages, apiKey)
        messages = [
          {
            role: 'system',
            content: `[Previous conversation summary]: ${summary}`,
          },
          messages[messages.length - 1], // Keep the most recent message
        ]
      } catch {
        // If summarization fails, just trim oldest messages
        messages = messages.slice(-4)
      }
    }

    return callLLMDirect(req.provider, req.model, messages, req.systemPrompt, apiKey)
  })
}
