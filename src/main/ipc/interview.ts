import { ipcMain, IpcMainEvent } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { IPC } from '../../shared/types'
import type { ChatMessage, SearchEvent, InterviewBrief, InterviewSession, InterviewExchange } from '../../shared/types'
import { getDb } from '../db'
import { getEncryptedKey } from './settings'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

function readSettings(): Record<string, unknown> {
  const settingsFile = path.join(app.getPath('userData'), 'settings.json')
  try {
    return JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
  } catch {
    return {}
  }
}

function rowToBrief(row: Record<string, unknown>): InterviewBrief {
  return {
    id: row.id as number,
    jobId: row.job_id as number,
    depth: row.depth as 'quick' | 'deep',
    content: row.content as string,
    sources: JSON.parse((row.sources as string) || '[]'),
    searchCount: row.search_count as number,
    briefVersion: row.brief_version as number,
    partial: !!(row.partial as number),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function rowToSession(row: Record<string, unknown>): InterviewSession {
  return {
    id: row.id as number,
    jobId: row.job_id as number,
    mode: row.mode as 'live_feedback' | 'full_run',
    categories: JSON.parse((row.categories as string) || '[]'),
    briefVersion: row.brief_version as number | null,
    status: row.status as 'in_progress' | 'paused' | 'completed',
    debriefText: row.debrief_text as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function rowToExchange(row: Record<string, unknown>): InterviewExchange {
  return {
    id: row.id as number,
    sessionId: row.session_id as number,
    sequence: row.sequence as number,
    questionText: row.question_text as string,
    answerText: row.answer_text as string,
    feedbackJson: row.feedback_json as string | undefined,
    createdAt: row.created_at as string,
  }
}

export function registerInterviewHandlers(): void {
  const db = getDb()

  // ─── Brief CRUD ────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.INTERVIEW_GET_BRIEF, (_evt, jobId: number) => {
    const row = db.prepare('SELECT * FROM interview_briefs WHERE job_id = ?').get(jobId) as Record<string, unknown> | undefined
    return row ? rowToBrief(row) : null
  })

  ipcMain.handle(IPC.INTERVIEW_SAVE_BRIEF, (_evt, data: Partial<InterviewBrief> & { jobId: number }) => {
    const existing = db.prepare('SELECT id, brief_version FROM interview_briefs WHERE job_id = ?').get(data.jobId) as { id: number; brief_version: number } | undefined
    if (existing) {
      db.prepare(`UPDATE interview_briefs SET content = ?, sources = ?, search_count = ?, depth = ?, brief_version = brief_version + 1, partial = ?, updated_at = datetime('now') WHERE job_id = ?`)
        .run(data.content ?? '', JSON.stringify(data.sources ?? []), data.searchCount ?? 0, data.depth ?? 'quick', data.partial ? 1 : 0, data.jobId)
    } else {
      db.prepare(`INSERT INTO interview_briefs (job_id, depth, content, sources, search_count, brief_version, partial) VALUES (?, ?, ?, ?, ?, 1, ?)`)
        .run(data.jobId, data.depth ?? 'quick', data.content ?? '', JSON.stringify(data.sources ?? []), data.searchCount ?? 0, data.partial ? 1 : 0)
    }
    return db.prepare('SELECT * FROM interview_briefs WHERE job_id = ?').get(data.jobId) as Record<string, unknown>
      ? rowToBrief(db.prepare('SELECT * FROM interview_briefs WHERE job_id = ?').get(data.jobId) as Record<string, unknown>)
      : null
  })

  // ─── Session CRUD ──────────────────────────────────────────────────────────

  ipcMain.handle(IPC.INTERVIEW_GET_SESSIONS, (_evt, jobId: number) => {
    const rows = db.prepare(`SELECT * FROM interview_sessions WHERE job_id = ? ORDER BY created_at DESC`).all(jobId) as Record<string, unknown>[]
    return rows.map(rowToSession)
  })

  ipcMain.handle(IPC.INTERVIEW_GET_SESSION, (_evt, sessionId: number) => {
    const row = db.prepare('SELECT * FROM interview_sessions WHERE id = ?').get(sessionId) as Record<string, unknown> | undefined
    return row ? rowToSession(row) : null
  })

  ipcMain.handle(IPC.INTERVIEW_CREATE_SESSION, (_evt, data: { jobId: number; mode: string; categories: string[] }) => {
    const brief = db.prepare('SELECT brief_version FROM interview_briefs WHERE job_id = ?').get(data.jobId) as { brief_version: number } | undefined
    const briefVersion = brief ? brief.brief_version : null
    const result = db.prepare(`INSERT INTO interview_sessions (job_id, mode, categories, brief_version, status) VALUES (?, ?, ?, ?, 'in_progress')`)
      .run(data.jobId, data.mode, JSON.stringify(data.categories), briefVersion)
    return result.lastInsertRowid as number
  })

  ipcMain.handle(IPC.INTERVIEW_UPDATE_SESSION, (_evt, sessionId: number, updates: { status?: string; debriefText?: string }) => {
    const fields: string[] = [`updated_at = datetime('now')`]
    const values: unknown[] = []
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.debriefText !== undefined) { fields.push('debrief_text = ?'); values.push(updates.debriefText) }
    values.push(sessionId)
    db.prepare(`UPDATE interview_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  })

  ipcMain.handle(IPC.INTERVIEW_DELETE_SESSION, (_evt, sessionId: number) => {
    db.prepare('DELETE FROM interview_sessions WHERE id = ?').run(sessionId)
  })

  // ─── Exchange CRUD ─────────────────────────────────────────────────────────

  ipcMain.handle(IPC.INTERVIEW_SAVE_EXCHANGE, (_evt, data: { sessionId: number; sequence: number; questionText: string; answerText?: string; feedbackJson?: string }) => {
    const existing = db.prepare('SELECT id FROM interview_exchanges WHERE session_id = ? AND sequence = ?').get(data.sessionId, data.sequence) as { id: number } | undefined
    if (existing) {
      db.prepare(`UPDATE interview_exchanges SET answer_text = ?, feedback_json = ? WHERE id = ?`)
        .run(data.answerText ?? '', data.feedbackJson ?? null, existing.id)
      return existing.id
    } else {
      const result = db.prepare(`INSERT INTO interview_exchanges (session_id, sequence, question_text, answer_text, feedback_json) VALUES (?, ?, ?, ?, ?)`)
        .run(data.sessionId, data.sequence, data.questionText, data.answerText ?? '', data.feedbackJson ?? null)
      // Auto-save: touch session updated_at
      db.prepare(`UPDATE interview_sessions SET updated_at = datetime('now') WHERE id = ?`).run(data.sessionId)
      return result.lastInsertRowid as number
    }
  })

  ipcMain.handle(IPC.INTERVIEW_GET_EXCHANGES, (_evt, sessionId: number) => {
    const rows = db.prepare('SELECT * FROM interview_exchanges WHERE session_id = ? ORDER BY sequence ASC').all(sessionId) as Record<string, unknown>[]
    return rows.map(rowToExchange)
  })

  // ─── Utility ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.INTERVIEW_APPEND_NOTES, (_evt, jobId: number, text: string) => {
    const existing = db.prepare('SELECT id, content FROM job_notes WHERE job_id = ?').get(jobId) as { id: number; content: string } | undefined
    const timestamp = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const appendText = `\n\n---\n**Interview Prep — ${timestamp}**\n\n${text}`
    if (existing) {
      db.prepare(`UPDATE job_notes SET content = ?, updated_at = datetime('now') WHERE job_id = ?`)
        .run((existing.content || '') + appendText, jobId)
    } else {
      db.prepare(`INSERT INTO job_notes (job_id, content) VALUES (?, ?)`)
        .run(jobId, appendText.trim())
    }
  })

  ipcMain.handle(IPC.INTERVIEW_HAS_ACTIVE, (_evt, jobId: number) => {
    const row = db.prepare(`SELECT id FROM interview_sessions WHERE job_id = ? AND status IN ('in_progress', 'paused') LIMIT 1`).get(jobId)
    return { hasActive: !!row }
  })

  // ─── Streaming: Research Generation ───────────────────────────────────────

  ipcMain.on('interview:start-research', async (event: IpcMainEvent, payload: {
    jobId: number
    depth: 'quick' | 'deep'
    model: string
    provider: 'anthropic' | 'openai'
    systemPrompt: string
    messages: ChatMessage[]
  }) => {
    const sender = event.sender
    const keyName = payload.provider === 'anthropic' ? 'anthropicKey' : 'openaiKey'
    const apiKey = getEncryptedKey(keyName)

    if (!apiKey) {
      sender.send('interview:stream-error', `No ${payload.provider} API key configured. Please add your key in Settings.`)
      return
    }

    let textContent = ''
    let searchCount = 0
    const sources: string[] = []
    let isPartial = false

    try {
      if (payload.provider === 'anthropic') {
        const client = new Anthropic({ apiKey })
        let inToolBlock = false
        let toolInputBuffer = ''

        const stream = client.messages.stream({
          model: payload.model,
          max_tokens: 8096,
          system: payload.systemPrompt,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: [{ type: 'web_search_20250305' as any, name: 'web_search' }],
          messages: payload.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        })

        for await (const evt of stream) {
          if (evt.type === 'content_block_start') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const block = evt.content_block as any
            if (block.type === 'tool_use' && block.name === 'web_search') {
              inToolBlock = true
              toolInputBuffer = ''
              sender.send('interview:search-event', {
                type: 'search_start',
                query: null,
                provider: 'anthropic',
              } satisfies SearchEvent)
            }
          } else if (evt.type === 'content_block_delta') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const delta = evt.delta as any
            if (delta.type === 'text_delta') {
              textContent += delta.text
              sender.send('interview:token', delta.text)
            } else if (delta.type === 'input_json_delta') {
              toolInputBuffer += delta.partial_json
            }
          } else if (evt.type === 'content_block_stop' && inToolBlock) {
            inToolBlock = false
            let query: string | null = null
            try {
              const input = JSON.parse(toolInputBuffer)
              query = input.query || null
            } catch { /* ignore */ }
            sender.send('interview:search-event', {
              type: 'search_complete',
              query,
              provider: 'anthropic',
            } satisfies SearchEvent)
            searchCount++
          }
        }

        // Extract sources from final message content
        try {
          const finalMsg = await stream.finalMessage()
          for (const block of finalMsg.content) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const b = block as any
            if (b.type === 'tool_result' || b.type === 'web_search_tool_result') {
              const content = b.content
              if (Array.isArray(content)) {
                for (const item of content) {
                  if (item.url && !sources.includes(item.url)) sources.push(item.url)
                  if (item.source?.url && !sources.includes(item.source.url)) sources.push(item.source.url)
                }
              }
            }
          }
        } catch { /* ignore source extraction errors */ }

      } else {
        // OpenAI — streaming chat completions (web search via responses API where available)
        const client = new OpenAI({ apiKey })

        try {
          // Try responses API with web_search_preview
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const respClient = (client as any).responses
          if (respClient) {
            const streamResp = await respClient.create({
              model: payload.model,
              tools: [{ type: 'web_search_preview' }],
              instructions: payload.systemPrompt,
              input: payload.messages.map(m => ({ role: m.role, content: m.content })),
              stream: true,
            })
            for await (const evt of streamResp) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const e = evt as any
              if (e.type === 'response.output_text.delta' && e.delta) {
                textContent += e.delta
                sender.send('interview:token', e.delta)
              }
              if (e.type === 'response.web_search_call.searching') {
                sender.send('interview:search-event', {
                  type: 'search_start',
                  query: e.query || null,
                  provider: 'openai',
                } satisfies SearchEvent)
                searchCount++
              }
              if (e.type === 'response.web_search_call.completed') {
                sender.send('interview:search-event', {
                  type: 'search_complete',
                  query: null,
                  provider: 'openai',
                } satisfies SearchEvent)
              }
            }
          } else {
            throw new Error('responses API not available')
          }
        } catch {
          // Fallback: regular streaming chat completions without web search
          const stream = await client.chat.completions.create({
            model: payload.model,
            messages: [
              { role: 'system', content: payload.systemPrompt + '\n\nNote: Web search is not available with this model configuration. Respond with your training knowledge.' },
              ...payload.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
            ],
            stream: true,
          })
          for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content || ''
            if (token) {
              textContent += token
              sender.send('interview:token', token)
            }
          }
        }
      }
    } catch (err) {
      isPartial = true
      // Try to save whatever we have before emitting error
      if (textContent.length < 100) {
        sender.send('interview:stream-error', String(err))
        return
      }
    }

    // Save/update brief in DB
    try {
      const dbInstance = getDb()
      const existing = dbInstance.prepare('SELECT id FROM interview_briefs WHERE job_id = ?').get(payload.jobId) as { id: number } | undefined
      if (existing) {
        dbInstance.prepare(`UPDATE interview_briefs SET content = ?, sources = ?, search_count = ?, depth = ?, brief_version = brief_version + 1, partial = ?, updated_at = datetime('now') WHERE job_id = ?`)
          .run(textContent, JSON.stringify(sources), searchCount, payload.depth, isPartial ? 1 : 0, payload.jobId)
      } else {
        dbInstance.prepare(`INSERT INTO interview_briefs (job_id, depth, content, sources, search_count, brief_version, partial) VALUES (?, ?, ?, ?, ?, 1, ?)`)
          .run(payload.jobId, payload.depth, textContent, JSON.stringify(sources), searchCount, isPartial ? 1 : 0)
      }

      const savedRow = dbInstance.prepare('SELECT * FROM interview_briefs WHERE job_id = ?').get(payload.jobId) as Record<string, unknown>
      sender.send('interview:research-done', { brief: rowToBrief(savedRow) })
    } catch (dbErr) {
      sender.send('interview:stream-error', String(dbErr))
    }
  })

  // ─── Streaming: Chat Message ───────────────────────────────────────────────

  ipcMain.on('interview:send-chat', async (event: IpcMainEvent, payload: {
    sessionId: number
    model: string
    provider: 'anthropic' | 'openai'
    systemPrompt: string
    messages: ChatMessage[]
  }) => {
    const sender = event.sender
    const keyName = payload.provider === 'anthropic' ? 'anthropicKey' : 'openaiKey'
    const apiKey = getEncryptedKey(keyName)

    if (!apiKey) {
      sender.send('interview:stream-error', `No ${payload.provider} API key configured.`)
      return
    }

    let fullResponse = ''

    try {
      if (payload.provider === 'anthropic') {
        const client = new Anthropic({ apiKey })
        const stream = client.messages.stream({
          model: payload.model,
          max_tokens: 4096,
          system: payload.systemPrompt,
          messages: payload.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        })
        for await (const evt of stream) {
          if (evt.type === 'content_block_delta') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const delta = evt.delta as any
            if (delta.type === 'text_delta') {
              fullResponse += delta.text
              sender.send('interview:chat-token', delta.text)
            }
          }
        }
      } else {
        const client = new OpenAI({ apiKey })
        const stream = await client.chat.completions.create({
          model: payload.model,
          messages: [
            { role: 'system', content: payload.systemPrompt },
            ...payload.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          ],
          stream: true,
        })
        for await (const chunk of stream) {
          const token = chunk.choices[0]?.delta?.content || ''
          if (token) {
            fullResponse += token
            sender.send('interview:chat-token', token)
          }
        }
      }
      sender.send('interview:chat-done', { content: fullResponse })
    } catch (err) {
      sender.send('interview:stream-error', String(err))
    }
  })
}
