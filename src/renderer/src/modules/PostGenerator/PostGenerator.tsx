import React, { useState, useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import {
  Link2, RefreshCw, Send, Copy, Clock, ChevronDown, ChevronUp,
  RotateCcw, Loader2, FileText, X, History, Plus, Trash2,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react'
import clsx from 'clsx'
import { useToast } from '../../shared/hooks/useToast'
import type { PostSession, PostSource, ChatMessage } from '@shared/types'

const SYSTEM_PROMPT = `LinkedIn Science Post Guidelines

SOURCE FIDELITY — MANDATORY:
- Write ONLY from the source material provided in the user message.
- Do not add any findings, mechanisms, numbers, gene names, drugs, pathways,
  cell types, or claims not explicitly stated in the provided abstract or text.
- If mechanistic detail is absent from the abstract, say so briefly ("the
  mechanism was not reported in this abstract") rather than speculating.
- Ignore anything you know about this topic from prior training if it is not
  confirmed by the provided text.

RESPONSE FORMAT (required):
Line 1:   TITLE: [your recommended LinkedIn post title]
Line 2:   (blank)
Line 3+:  Post body, hashtags, citation as usual

Core Principles:
- Target length: 200–250 words
- Write for scientists, engineers, and biotech professionals who value precision and nuance
- Lead with mechanism and context, not hype
- Always acknowledge limitations and uncertainty
- End with a question that invites expert discussion, not agreement

Structure (4–5 paragraphs):
1. Opening (2–3 sentences): State the finding plainly and link it to broader context or a known problem.
2. Key findings (3–4 sentences): Summarize the experimental approach and main results.
3. Mechanism (2–4 sentences): Explain molecular/cellular/circuit-level detail only if explicitly described in the source material.
4. Limitations & context (2–3 sentences): Note what remains unknown, model limitations, translational gaps, or complicating factors.
5. Closing question: Open-ended, reflecting on implications or adjacent questions. No yes/no questions.

Style rules:
- No em dashes, minimal bold/italics
- Avoid: "exciting," "groundbreaking," "game-changing," "revolutionary"
- Avoid: "sheds light on," "paves the way," "opens doors"
- Use precise technical terms without over-explaining
- Write like talking to a colleague, not lecturing a student
- Be conservative about clinical timelines and probability

Title: Outcome-focused ("How X does Y" / "Why X happens under Y conditions"). No clickbait.
Hashtags: 3–5 relevant field/method terms only.
Citation: Author et al., Journal Volume, Pages (Year). DOI only if particularly relevant.
When in doubt: Cut more than you think you need to. Trust the reader's expertise.`

function countBodyWords(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const words = text.split(/\s+/).filter(Boolean)
  return words.length
}

function getWordCountColor(count: number): string {
  if (count >= 200 && count <= 250) return 'text-success'
  if (count >= 175 && count <= 275) return 'text-warning'
  return 'text-error'
}

function makeSource(role: 'primary' | 'context' = 'primary'): PostSource {
  return { id: String(Date.now() + Math.random()), role, type: 'url' }
}

interface SourceCardProps {
  src: PostSource
  index: number
  onUpdate: (id: string, patch: Partial<PostSource>) => void
  onRemove: (id: string) => void
  onFetchUrl: (id: string) => void
}

function SourceCard({ src, index, onUpdate, onRemove, onFetchUrl }: SourceCardProps) {
  const [previewExpanded, setPreviewExpanded] = useState(true)

  return (
    <div className="card p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <button
            onClick={() => onUpdate(src.id, { role: 'primary' })}
            className={clsx('px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide transition-colors',
              src.role === 'primary' ? 'bg-accent text-white' : 'bg-surface-2 text-text-dim hover:bg-surface-3')}
          >Primary</button>
          <button
            onClick={() => onUpdate(src.id, { role: 'context' })}
            className={clsx('px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide transition-colors',
              src.role === 'context' ? 'bg-accent/70 text-white' : 'bg-surface-2 text-text-dim hover:bg-surface-3')}
          >Context</button>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex rounded overflow-hidden border border-border text-[10px]">
            <button
              onClick={() => onUpdate(src.id, { type: 'url' })}
              className={clsx('px-2 py-0.5 transition-colors', src.type === 'url' ? 'bg-surface-2 text-text' : 'text-text-dim hover:bg-surface-2')}
            >URL</button>
            <button
              onClick={() => onUpdate(src.id, { type: 'text' })}
              className={clsx('px-2 py-0.5 transition-colors', src.type === 'text' ? 'bg-surface-2 text-text' : 'text-text-dim hover:bg-surface-2')}
            >Paste</button>
          </div>
          {index > 0 && (
            <button onClick={() => onRemove(src.id)} className="btn-ghost p-1 text-text-dim hover:text-error">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* URL input */}
      {src.type === 'url' && (
        <>
          <div className="flex gap-1.5">
            <input
              type="url"
              value={src.url || ''}
              onChange={e => onUpdate(src.id, { url: e.target.value, preview: undefined })}
              placeholder="https://pubmed.ncbi.nlm.nih.gov/..."
              className="input flex-1 text-xs"
              onKeyDown={e => e.key === 'Enter' && onFetchUrl(src.id)}
            />
            <button
              onClick={() => onFetchUrl(src.id)}
              disabled={!src.url || src.isFetching}
              className="btn-secondary flex-shrink-0 text-xs px-2"
            >
              {src.isFetching ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
            </button>
          </div>
          {src.url?.trim() && !src.preview && (
            <p className="text-[10px] text-warning">Fetch required — URL alone won't be sent to the LLM</p>
          )}
        </>
      )}

      {/* Text input */}
      {src.type === 'text' && (
        <textarea
          value={src.text || ''}
          onChange={e => onUpdate(src.id, { text: e.target.value })}
          placeholder="Paste article text or abstract..."
          className="input resize-none text-xs w-full"
          rows={4}
        />
      )}

      {/* Preview */}
      {src.preview && (
        <div className="space-y-1 pt-1 border-t border-border/50">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-success uppercase tracking-wide">Fetched</span>
            <div className="flex gap-0.5">
              <button onClick={() => setPreviewExpanded(!previewExpanded)} className="btn-ghost p-0.5">
                {previewExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
              <button onClick={() => onUpdate(src.id, { preview: undefined })} className="btn-ghost p-0.5">
                <X size={11} />
              </button>
            </div>
          </div>
          {previewExpanded && (
            <div className="text-[11px] text-text-muted space-y-0.5">
              <p className="text-text font-medium leading-snug">{src.preview.title}</p>
              {src.preview.authors && <p className="text-text-dim">{src.preview.authors}</p>}
              {src.preview.journal && <p className="text-accent">{src.preview.journal}</p>}
              {src.preview.abstract && <p className="text-text-dim line-clamp-2">{src.preview.abstract}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function PostGenerator() {
  const { toast } = useToast()
  const [sessions, setSessions] = useState<PostSession[]>([])
  const [currentSession, setCurrentSession] = useState<PostSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sources, setSources] = useState<PostSource[]>([makeSource('primary')])
  const [userNotes, setUserNotes] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [revisionInput, setRevisionInput] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [regenerateModalOpen, setRegenerateModalOpen] = useState(false)
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic')
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false)
  const [postTitle, setPostTitle] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Check for paper handoff from Paper Discovery
  useEffect(() => {
    const paperData = sessionStorage.getItem('postGeneratorPaper')
    if (paperData) {
      sessionStorage.removeItem('postGeneratorPaper')
      const paper = JSON.parse(paperData)
      setSources([{
        id: String(Date.now()),
        role: 'primary',
        type: 'url',
        url: paper.url || '',
        preview: {
          title: paper.title || '',
          authors: paper.authors || '',
          journal: paper.journal || '',
          abstract: paper.abstract || '',
        },
      }])
    }
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Generated post will appear here...' }),
      CharacterCount,
    ],
    editorProps: { attributes: { class: 'tiptap-editor' } },
  })

  const wordCount = editor ? countBodyWords(editor.getHTML()) : 0

  useEffect(() => { loadSessions(); loadSettings() }, [])

  async function loadSettings() {
    const s = await window.api.getSettings() as { models?: { postGenerator?: string } }
    const m = s.models?.postGenerator || 'claude-sonnet-4-6'
    setModel(m)
    setProvider(m.startsWith('gpt') ? 'openai' : 'anthropic')
  }

  async function loadSessions() {
    const s = await window.api.postGetSessions() as PostSession[]
    setSessions(s)
  }

  async function handleNewSession() {
    // Auto-save current editor content before clearing, so nothing is lost
    if (currentSession?.id && editor) {
      const currentContent = editor.getText().trim()
      if (currentContent) {
        const cleanSources = sources.map(({ isFetching: _f, ...rest }) => rest)
        await window.api.postSaveSession({
          id: currentSession.id,
          title: postTitle || undefined,
          sources: cleanSources,
          currentPost: editor.getHTML(),
          messages,
          wordCount,
        })
      }
    }
    setCurrentSession(null)
    setMessages([])
    setSources([makeSource('primary')])
    setUserNotes('')
    setPostTitle('')
    editor?.commands.clearContent()
    await loadSessions()
  }

  // ── Source management ──────────────────────────────────────────────────────

  function updateSource(id: string, patch: Partial<PostSource>) {
    setSources(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  function removeSource(id: string) {
    setSources(prev => {
      const next = prev.filter(s => s.id !== id)
      return next.length ? next : [makeSource('primary')]
    })
  }

  async function handleFetchSourceUrl(id: string) {
    const src = sources.find(s => s.id === id)
    if (!src?.url?.trim()) return
    updateSource(id, { isFetching: true })
    try {
      const result = await window.api.postFetchUrl(src.url) as { success: boolean; title?: string; authors?: string; journal?: string; abstract?: string; error?: string }
      if (result.success) {
        updateSource(id, {
          isFetching: false,
          preview: {
            title: result.title || '',
            authors: result.authors || '',
            journal: result.journal || '',
            abstract: result.abstract || '',
          },
        })
        toast('success', 'Article fetched')
      } else {
        updateSource(id, { isFetching: false })
        toast('error', result.error || 'Failed to fetch')
      }
    } catch (err) {
      updateSource(id, { isFetching: false })
      toast('error', String(err))
    }
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  function buildSourcePrompt(): string {
    const primary = sources.find(s => s.role === 'primary')
    const contextSources = sources.filter(s => s.role === 'context')
    const parts: string[] = []

    function sourceDesc(src: PostSource): string | null {
      if (src.preview) {
        return `Title: ${src.preview.title}\nAuthors: ${src.preview.authors}\nJournal: ${src.preview.journal}\nAbstract: ${src.preview.abstract}`
      }
      if (src.text?.trim()) return src.text.trim()
      return null // URL-only, unfetched — skip
    }

    if (primary) {
      const desc = sourceDesc(primary)
      if (desc) parts.push(`Primary source:\n${desc}`)
    }
    const contextDescs = contextSources.map(s => sourceDesc(s)).filter(Boolean) as string[]
    if (contextDescs.length) {
      parts.push(`Additional context:\n${contextDescs.join('\n\n')}`)
    }
    return parts.join('\n\n')
  }

  function parseLLMResponse(raw: string): { title: string; body: string } {
    const lines = raw.trim().split('\n')
    if (lines[0].match(/^TITLE:\s*/i)) {
      const title = lines[0].replace(/^TITLE:\s*/i, '').trim()
      const rest = lines.slice(1)
      const firstContent = rest.findIndex(l => l.trim() !== '')
      const body = rest.slice(firstContent >= 0 ? firstContent : 0).join('\n').trim()
      return { title, body }
    }
    return { title: '', body: raw.trim() }
  }

  async function handleGenerate() {
    const sourceContent = buildSourcePrompt()
    if (!sourceContent.trim()) { toast('error', 'Add a source first'); return }
    setIsGenerating(true)
    const userMsg: ChatMessage = {
      role: 'user',
      content: `Generate a LinkedIn science post about:\n\n${sourceContent}${userNotes ? `\n\nAdditional context / angle: ${userNotes}` : ''}`,
    }
    const newMessages = [userMsg]
    setMessages(newMessages)
    try {
      const result = await window.api.llmCall({ provider, model, messages: newMessages, systemPrompt: SYSTEM_PROMPT }) as { content: string }
      const parsed = parseLLMResponse(result.content)
      editor?.commands.setContent(`<p>${parsed.body.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`)
      if (parsed.title && !postTitle.trim()) setPostTitle(parsed.title)
      const updatedMessages: ChatMessage[] = [...newMessages, { role: 'assistant', content: result.content }]
      setMessages(updatedMessages)
      const cleanSources = sources.map(({ isFetching: _f, ...rest }) => rest)
      const effectiveTitle = postTitle.trim() || parsed.title || undefined
      const sessionId = await window.api.postSaveSession({
        id: currentSession?.id,
        title: effectiveTitle,
        sources: cleanSources,
        currentPost: parsed.body,
        messages: updatedMessages,
        wordCount,
      }) as number
      setCurrentSession({ ...currentSession, id: sessionId } as PostSession)
      await loadSessions()
    } catch (err) { toast('error', String(err), true) }
    finally { setIsGenerating(false) }
  }

  async function handleRevision() {
    if (!revisionInput.trim() || !editor) return
    setIsGenerating(true)
    const newMessages: ChatMessage[] = [...messages, { role: 'assistant', content: editor.getText() }, { role: 'user', content: revisionInput }]
    setMessages(newMessages)
    setRevisionInput('')
    try {
      const result = await window.api.llmCall({ provider, model, messages: newMessages, systemPrompt: SYSTEM_PROMPT }) as { content: string }
      const parsed = parseLLMResponse(result.content)
      editor.commands.setContent(`<p>${parsed.body.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`)
      if (parsed.title && !postTitle.trim()) setPostTitle(parsed.title)
      const updatedMessages: ChatMessage[] = [...newMessages, { role: 'assistant', content: result.content }]
      setMessages(updatedMessages)
      const cleanSources = sources.map(({ isFetching: _f, ...rest }) => rest)
      const effectiveTitle = postTitle.trim() || parsed.title || undefined
      await window.api.postSaveSession({ id: currentSession?.id, title: effectiveTitle, sources: cleanSources, currentPost: parsed.body, messages: updatedMessages, wordCount })
    } catch (err) { toast('error', String(err), true) }
    finally { setIsGenerating(false) }
  }

  function handleCopy() {
    if (!editor) return
    const html = editor.getHTML()
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    const paragraphs = Array.from(tmp.querySelectorAll('p, h1, h2, h3')).map(el => el.textContent?.trim()).filter(Boolean)
    navigator.clipboard.writeText(paragraphs.join('\n\n'))
    toast('success', 'Copied to clipboard')
  }

  async function handleRegenerateOption(fresh: boolean) {
    setRegenerateModalOpen(false)
    if (fresh) { setMessages([]); await handleGenerate(); return }
    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: 'Please generate a completely new version from scratch.' }]
    setMessages(newMessages)
    setIsGenerating(true)
    try {
      const result = await window.api.llmCall({ provider, model, messages: newMessages, systemPrompt: SYSTEM_PROMPT }) as { content: string }
      editor?.commands.setContent(`<p>${result.content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`)
      setMessages([...newMessages, { role: 'assistant', content: result.content }])
    } catch (err) { toast('error', String(err), true) }
    finally { setIsGenerating(false) }
  }

  async function loadSession(session: PostSession) {
    const full = await window.api.postGetSession(session.id) as PostSession
    setCurrentSession(full)
    setMessages(full.messages || [])
    setSources(full.sources?.length ? full.sources : [makeSource('primary')])
    setPostTitle(full.title || '')
    setUserNotes('')
    editor?.commands.setContent(`<p>${(full.currentPost || '').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`)
  }

  async function handleDeleteSession(id: number, e: React.MouseEvent) {
    e.stopPropagation()
    await window.api.postDeleteSession(id)
    if (currentSession?.id === id) handleNewSession()
    await loadSessions()
  }

  // ── Session label helper ──────────────────────────────────────────────────

  function sessionLabel(s: PostSession): string {
    return s.title || (s as unknown as { paper_title?: string }).paper_title || s.paperTitle || 'Untitled'
  }

  const canGenerate = sources.some(s => s.preview || s.text?.trim())

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Sessions Panel ─────────────────────────────────────────────────── */}
      <div className={clsx(
        'flex flex-col border-r border-border overflow-hidden flex-shrink-0 transition-all duration-200',
        sessionsCollapsed ? 'w-10' : 'w-52'
      )}>
        {sessionsCollapsed ? (
          /* ── Icon-only strip ─── */
          <div className="flex flex-col items-center gap-2 py-3">
            <button
              onClick={handleNewSession}
              title="New Post"
              className="btn-ghost p-1.5 text-accent hover:bg-accent/10"
            >
              <Plus size={16} />
            </button>
            {sessions.length > 0 && (
              <span className="text-[9px] font-semibold text-text-dim bg-surface-2 rounded-full px-1.5 py-0.5 leading-none">
                {sessions.length}
              </span>
            )}
            <button
              onClick={() => setSessionsCollapsed(false)}
              title="Expand sessions"
              className="btn-ghost p-1.5 text-text-dim hover:text-text mt-1"
            >
              <PanelLeftOpen size={15} />
            </button>
          </div>
        ) : (
          /* ── Expanded panel ─── */
          <>
            <div className="p-3 border-b border-border flex-shrink-0 flex items-center gap-2">
              <button onClick={handleNewSession} className="btn-primary flex-1 justify-center text-xs gap-1.5">
                <Plus size={13} /> New Post
              </button>
              <button
                onClick={() => setSessionsCollapsed(true)}
                title="Collapse sessions"
                className="btn-ghost p-1.5 text-text-dim hover:text-text flex-shrink-0"
              >
                <PanelLeftClose size={15} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sessions.length === 0 && (
                <p className="p-3 text-xs text-text-dim">No saved sessions</p>
              )}
              {sessions.map(s => (
                <button
                  key={s.id}
                  onClick={() => loadSession(s)}
                  className={clsx(
                    'group w-full text-left px-3 py-2.5 border-b border-border/40 transition-colors hover:bg-surface-2',
                    currentSession?.id === s.id && 'bg-surface-2 border-l-2 border-l-accent'
                  )}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-text truncate leading-snug">{sessionLabel(s)}</p>
                      <p className="text-[10px] text-text-dim mt-0.5 flex items-center gap-1">
                        <Clock size={9} />
                        {new Date(s.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={e => handleDeleteSession(s.id, e)}
                      className="opacity-0 group-hover:opacity-100 btn-ghost p-0.5 text-text-dim hover:text-error flex-shrink-0 mt-0.5 transition-opacity"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Sources + Input Panel ──────────────────────────────────────────── */}
      <div className="w-80 flex flex-col border-r border-border overflow-hidden flex-shrink-0">
        <div className="p-3 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-semibold">Sources</h2>
          <p className="text-[11px] text-text-muted">Add articles or text to generate from</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {sources.map((src, i) => (
            <SourceCard
              key={src.id}
              src={src}
              index={i}
              onUpdate={updateSource}
              onRemove={removeSource}
              onFetchUrl={handleFetchSourceUrl}
            />
          ))}
          <button
            onClick={() => setSources(prev => [...prev, makeSource('context')])}
            className="btn-ghost w-full justify-center text-xs gap-1.5 border border-dashed border-border"
          >
            <Plus size={12} /> Add source
          </button>

          <div className="pt-1">
            <label className="block text-xs font-medium text-text-muted mb-1.5">Your angle / emphasis</label>
            <textarea
              value={userNotes}
              onChange={e => setUserNotes(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  editor?.getText() ? handleRevision() : handleGenerate()
                }
              }}
              placeholder="Focus on the N2 polarization mechanism..."
              className="input resize-none text-xs w-full"
              rows={3}
            />
            <p className="text-[10px] text-text-dim mt-1">Cmd+Enter to generate</p>
          </div>
        </div>
        <div className="p-3 border-t border-border flex-shrink-0">
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !canGenerate}
            className="btn-primary w-full justify-center"
          >
            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Generate Post
          </button>
        </div>
      </div>

      {/* ── Editor Panel ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Title row */}
        <div className="px-4 pt-3 pb-2 border-b border-border flex-shrink-0">
          <input
            type="text"
            value={postTitle}
            onChange={e => setPostTitle(e.target.value)}
            onBlur={async () => {
              if (currentSession?.id) {
                const cleanSources = sources.map(({ isFetching: _f, ...rest }) => rest)
                await window.api.postSaveSession({ id: currentSession.id, title: postTitle || undefined, sources: cleanSources, currentPost: editor?.getHTML() || '', messages, wordCount })
                await loadSessions()
              }
            }}
            placeholder="Untitled post"
            className="w-full bg-transparent text-base font-semibold text-text placeholder:text-text-dim/40 outline-none border-none focus:ring-0 p-0"
          />
        </div>
        <div className="flex items-center gap-2 p-3 border-b border-border flex-shrink-0">
          <input
            type="text"
            value={revisionInput}
            onChange={e => setRevisionInput(e.target.value)}
            placeholder="Request a revision... (Cmd+Enter)"
            className="input flex-1"
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleRevision() } }}
          />
          <button onClick={handleRevision} disabled={!revisionInput || isGenerating} className="btn-primary flex-shrink-0">
            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
          <button onClick={() => messages.length > 0 ? setRegenerateModalOpen(true) : handleGenerate()} disabled={isGenerating} className="btn-secondary flex-shrink-0"><RefreshCw size={14} /></button>
          <button onClick={handleCopy} className="btn-secondary flex-shrink-0"><Copy size={14} /></button>
          <button onClick={() => setHistoryOpen(!historyOpen)} className={clsx('btn-secondary flex-shrink-0', historyOpen && 'border-accent/50 text-accent')}><History size={14} /></button>
        </div>
        <div className="px-4 py-1.5 flex items-center gap-3 border-b border-border/50 flex-shrink-0">
          <span className={clsx('text-xs font-mono font-medium', getWordCountColor(wordCount))}>{wordCount} words</span>
          <span className="text-xs text-text-dim">target: 200–250 (body)</span>
        </div>
        <div className="flex-1 overflow-y-auto relative">
          {isGenerating && (
            <div className="absolute inset-0 z-10 bg-bg/80 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={24} className="animate-spin text-accent" />
                <span className="text-sm text-text-muted">Generating...</span>
              </div>
            </div>
          )}
          <div className="tiptap-editor p-4"><EditorContent editor={editor} /></div>
        </div>
      </div>

      {/* ── History Drawer ─────────────────────────────────────────────────── */}
      {historyOpen && (
        <div className="w-72 border-l border-border flex flex-col overflow-hidden bg-surface flex-shrink-0">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <span className="text-sm font-medium">Conversation</span>
            <button onClick={() => setHistoryOpen(false)} className="btn-ghost p-1"><X size={14} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && <p className="text-xs text-text-dim">No conversation yet</p>}
            {messages.map((msg, i) => (
              <div key={i} className={clsx('rounded-lg p-2.5 text-xs', msg.role === 'user' ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-text-muted')}>
                <div className="font-semibold mb-1 uppercase tracking-wider text-[10px] opacity-60">{msg.role}</div>
                <div className="line-clamp-6 whitespace-pre-wrap">{msg.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Regenerate Modal ───────────────────────────────────────────────── */}
      {regenerateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card p-6 w-80 space-y-4">
            <h3 className="text-sm font-semibold">Regenerate post</h3>
            <div className="space-y-2">
              <button onClick={() => handleRegenerateOption(true)} className="btn-secondary w-full justify-start text-left gap-3">
                <RotateCcw size={14} />
                <div>
                  <div className="font-medium">Start fresh</div>
                  <div className="text-xs text-text-dim">Clear conversation, generate from source</div>
                </div>
              </button>
              <button onClick={() => handleRegenerateOption(false)} className="btn-secondary w-full justify-start text-left gap-3">
                <RefreshCw size={14} />
                <div>
                  <div className="font-medium">Ask LLM to try again</div>
                  <div className="text-xs text-text-dim">Keep conversation, request new version</div>
                </div>
              </button>
            </div>
            <button onClick={() => setRegenerateModalOpen(false)} className="btn-ghost w-full justify-center text-xs">Cancel</button>
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" />
    </div>
  )
}
