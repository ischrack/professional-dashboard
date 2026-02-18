import React, { useState, useEffect } from 'react'
import { Plus, Loader2, Copy, Bookmark, BookmarkCheck, Trash2, ChevronDown } from 'lucide-react'
import type { Job, QAEntry } from '@shared/types'
import { useToast } from '../../shared/hooks/useToast'

const QA_SYSTEM = `You are helping a biomedical scientist answer job application questions.
Use the provided resume and job context to write a tailored, specific response.
Be concrete and reference actual experiences. Avoid generic phrases.
Stay within any character limit specified.`

interface Props {
  job: Job
}

export default function QATab({ job }: Props) {
  const { toast } = useToast()
  const [entries, setEntries] = useState<QAEntry[]>([])
  const [templates, setTemplates] = useState<QAEntry[]>([])
  const [question, setQuestion] = useState('')
  const [charLimit, setCharLimit] = useState<number | undefined>()
  const [generating, setGenerating] = useState(false)
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [showTemplates, setShowTemplates] = useState(false)

  useEffect(() => {
    loadData()
  }, [job.id])

  async function loadData() {
    const [e, t, s] = await Promise.all([
      window.api.jobGetQa(job.id) as Promise<QAEntry[]>,
      window.api.jobGetQaTemplates() as Promise<QAEntry[]>,
      window.api.getSettings() as Promise<Record<string, unknown>>,
    ])
    setEntries(e)
    setTemplates(t)
    setSettings(s)
  }

  async function handleGenerate() {
    if (!question.trim()) return
    setGenerating(true)

    // Build context: resume + notes + cover letter
    const [notes, coverLetterMat] = await Promise.all([
      window.api.jobGetNotes(job.id) as Promise<string>,
      window.api.jobGetMaterial(job.id, 'cover_letter') as Promise<{ content?: string } | null>,
    ])

    let context = `Job: ${job.title} at ${job.company}\n\nJob Description:\n${job.description || 'Not available'}`
    if (notes) context += `\n\nJob Notes:\n${notes}`
    if (coverLetterMat?.content) context += `\n\nCover Letter (drafted):\n${coverLetterMat.content.slice(0, 1000)}`
    if (charLimit) context += `\n\nIMPORTANT: Stay within ${charLimit} characters.`

    const models = settings.models as Record<string, string> || {}
    const model = models.qaGenerator || 'claude-sonnet-4-6'
    const provider = model.startsWith('gpt') ? 'openai' : 'anthropic'

    try {
      const result = await window.api.llmCall({
        provider, model,
        messages: [{ role: 'user', content: `Question: ${question}\n\nContext:\n${context}` }],
        systemPrompt: QA_SYSTEM,
      }) as { content: string }

      const newEntry: Partial<QAEntry> = {
        jobId: job.id,
        question,
        answer: result.content,
        charLimit,
        isTemplate: false,
      }
      const id = await window.api.jobSaveQa(newEntry as Record<string, unknown>) as number
      setEntries(prev => [{ ...newEntry, id, createdAt: new Date().toISOString() } as QAEntry, ...prev])
      setQuestion('')
      setCharLimit(undefined)
    } catch (err) {
      toast('error', String(err), true)
    } finally {
      setGenerating(false)
    }
  }

  async function handleSaveAsTemplate(entry: QAEntry) {
    const name = prompt('Template name (optional):') || entry.question.slice(0, 50)
    await window.api.jobSaveQa({
      ...entry,
      id: undefined,
      jobId: undefined,
      isTemplate: true,
      templateName: name,
    } as Record<string, unknown>)
    const t = await window.api.jobGetQaTemplates() as QAEntry[]
    setTemplates(t)
    toast('success', 'Saved as template')
  }

  async function handleDelete(id: number) {
    await window.api.jobDeleteQa(id)
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  function useTemplate(t: QAEntry) {
    setQuestion(t.question)
    setShowTemplates(false)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Input area */}
      <div className="p-3 border-b border-border space-y-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-muted">Application Q&A</span>
          {templates.length > 0 && (
            <button onClick={() => setShowTemplates(!showTemplates)} className="btn-ghost text-xs py-0.5 gap-1">
              <BookmarkCheck size={11} />
              Templates ({templates.length})
              <ChevronDown size={10} className={showTemplates ? 'rotate-180' : ''} />
            </button>
          )}
        </div>

        {showTemplates && (
          <div className="card p-2 space-y-1 max-h-32 overflow-y-auto">
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => useTemplate(t)}
                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
              >
                {t.templateName || t.question}
              </button>
            ))}
          </div>
        )}

        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Paste the application question here..."
          className="input resize-none text-xs"
          rows={3}
        />
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={charLimit || ''}
            onChange={e => setCharLimit(e.target.value ? parseInt(e.target.value) : undefined)}
            placeholder="Char limit (optional)"
            className="input text-xs py-1 w-36"
          />
          <button
            onClick={handleGenerate}
            disabled={!question.trim() || generating}
            className="btn-primary text-xs flex-1 justify-center"
          >
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Generate Answer
          </button>
        </div>
      </div>

      {/* Q&A list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {entries.length === 0 && (
          <p className="text-xs text-text-dim text-center py-8">No Q&A answers yet</p>
        )}
        {entries.map(entry => (
          <div key={entry.id} className="card p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold text-accent">{entry.question}</p>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => navigator.clipboard.writeText(entry.answer).then(() => toast('success', 'Copied'))} className="btn-ghost p-1" title="Copy">
                  <Copy size={12} />
                </button>
                <button onClick={() => handleSaveAsTemplate(entry)} className="btn-ghost p-1" title="Save as template">
                  <Bookmark size={12} />
                </button>
                <button onClick={() => handleDelete(entry.id)} className="btn-ghost p-1 hover:text-error" title="Delete">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            <p className="text-xs text-text-muted leading-relaxed whitespace-pre-wrap">{entry.answer}</p>
            <div className="flex items-center gap-2 text-[10px] text-text-dim">
              {entry.charLimit && (
                <span className={entry.answer.length > entry.charLimit ? 'text-error' : ''}>
                  {entry.answer.length}/{entry.charLimit} chars
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
