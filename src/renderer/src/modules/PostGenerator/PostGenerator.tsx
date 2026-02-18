import React, { useState, useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import {
  Link2, Upload, RefreshCw, Send, Copy, Clock, ChevronDown, ChevronUp,
  RotateCcw, Loader2, FileText, X, History
} from 'lucide-react'
import clsx from 'clsx'
import { useToast } from '../../shared/hooks/useToast'
import type { PostSession, ChatMessage } from '@shared/types'

const SYSTEM_PROMPT = `LinkedIn Science Post Guidelines

Core Principles:
- Target length: 200–250 words
- Write for scientists, engineers, and biotech professionals who value precision and nuance
- Lead with mechanism and context, not hype
- Always acknowledge limitations and uncertainty
- End with a question that invites expert discussion, not agreement

Structure (4–5 paragraphs):
1. Opening (2–3 sentences): State the finding plainly and link it to broader context or a known problem.
2. Key findings (3–4 sentences): Summarize the experimental approach and main results.
3. Mechanism (2–4 sentences): Explain molecular/cellular/circuit-level detail. This is where scientific depth matters most.
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

interface ArticlePreview {
  title: string
  authors: string
  journal: string
  abstract: string
  url: string
}

export default function PostGenerator() {
  const { toast } = useToast()
  const [sessions, setSessions] = useState<PostSession[]>([])
  const [currentSession, setCurrentSession] = useState<PostSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [url, setUrl] = useState('')
  const [pastedText, setPastedText] = useState('')
  const [userNotes, setUserNotes] = useState('')
  const [preview, setPreview] = useState<ArticlePreview | null>(null)
  const [previewExpanded, setPreviewExpanded] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [revisionInput, setRevisionInput] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [regenerateModalOpen, setRegenerateModalOpen] = useState(false)
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Check for paper handoff from Paper Discovery
  useEffect(() => {
    const paperData = sessionStorage.getItem('postGeneratorPaper')
    if (paperData) {
      sessionStorage.removeItem('postGeneratorPaper')
      const paper = JSON.parse(paperData)
      setUrl(paper.url || '')
      setPreview(paper)
      setPreviewExpanded(true)
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

  async function handleFetchUrl() {
    if (!url.trim()) return
    setIsFetching(true)
    try {
      const result = await window.api.postFetchUrl(url) as { success: boolean; title?: string; authors?: string; journal?: string; abstract?: string; error?: string }
      if (result.success) {
        setPreview({ title: result.title || '', authors: result.authors || '', journal: result.journal || '', abstract: result.abstract || '', url })
        setPreviewExpanded(true)
        toast('success', 'Article fetched')
      } else {
        toast('error', result.error || 'Failed to fetch')
      }
    } catch (err) { toast('error', String(err)) }
    finally { setIsFetching(false) }
  }

  async function handleGenerate() {
    const sourceContent = preview
      ? `Title: ${preview.title}\nAuthors: ${preview.authors}\nJournal: ${preview.journal}\nAbstract: ${preview.abstract}`
      : pastedText || url
    if (!sourceContent.trim()) { toast('error', 'Add a source first'); return }
    setIsGenerating(true)
    const userMsg: ChatMessage = {
      role: 'user',
      content: `Generate a LinkedIn science post about:\n\n${sourceContent}${userNotes ? `\n\nAdditional context: ${userNotes}` : ''}`,
    }
    const newMessages = [userMsg]
    setMessages(newMessages)
    try {
      const result = await window.api.llmCall({ provider, model, messages: newMessages, systemPrompt: SYSTEM_PROMPT }) as { content: string }
      editor?.commands.setContent(`<p>${result.content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`)
      const updatedMessages: ChatMessage[] = [...newMessages, { role: 'assistant', content: result.content }]
      setMessages(updatedMessages)
      const sessionId = await window.api.postSaveSession({
        id: currentSession?.id, sourceUrl: url || undefined, sourceText: pastedText || undefined,
        paperTitle: preview?.title, paperAuthors: preview?.authors, paperJournal: preview?.journal,
        paperAbstract: preview?.abstract, currentPost: result.content, messages: updatedMessages, wordCount,
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
      editor.commands.setContent(`<p>${result.content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`)
      const updatedMessages: ChatMessage[] = [...newMessages, { role: 'assistant', content: result.content }]
      setMessages(updatedMessages)
      await window.api.postSaveSession({ id: currentSession?.id, currentPost: result.content, messages: updatedMessages, wordCount })
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
    setUrl(full.sourceUrl || '')
    setPastedText(full.sourceText || '')
    if (full.paperTitle) setPreview({ title: full.paperTitle || '', authors: full.paperAuthors || '', journal: full.paperJournal || '', abstract: full.paperAbstract || '', url: full.sourceUrl || '' })
    editor?.commands.setContent(`<p>${(full.currentPost || '').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`)
    setSessionsOpen(false)
    toast('info', `Loaded: ${full.paperTitle || 'Untitled'}`)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Input Panel */}
      <div className="w-2/5 flex flex-col border-r border-border overflow-hidden">
        <div className="p-4 border-b border-border flex-shrink-0">
          <h2 className="text-base font-semibold">Post Generator</h2>
          <p className="text-xs text-text-muted">LinkedIn science posts in your house style</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Article URL</label>
            <div className="flex gap-2">
              <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://pubmed.ncbi.nlm.nih.gov/..." className="input flex-1" onKeyDown={e => e.key === 'Enter' && handleFetchUrl()} />
              <button onClick={handleFetchUrl} disabled={!url || isFetching} className="btn-secondary flex-shrink-0">
                {isFetching ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Fetch
              </button>
            </div>
          </div>
          {preview && (
            <div className="card p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-success">Article detected</span>
                <div className="flex gap-1">
                  <button onClick={() => setPreviewExpanded(!previewExpanded)} className="btn-ghost p-1">{previewExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
                  <button onClick={() => setPreview(null)} className="btn-ghost p-1"><X size={12} /></button>
                </div>
              </div>
              {previewExpanded && (
                <div className="text-xs text-text-muted space-y-1">
                  <p className="text-text font-medium">{preview.title}</p>
                  {preview.authors && <p>{preview.authors}</p>}
                  {preview.journal && <p className="text-accent">{preview.journal}</p>}
                  {preview.abstract && <p className="text-text-dim line-clamp-3">{preview.abstract}</p>}
                </div>
              )}
            </div>
          )}
          <div className={clsx('drag-zone p-4 text-center cursor-pointer', isDragging && 'drag-active')}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false) }}
            onClick={() => fileInputRef.current?.click()}>
            <Upload size={20} className="mx-auto mb-2 text-text-dim" />
            <p className="text-xs text-text-muted">Drop a PDF or click to browse</p>
            <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Or paste text / abstract</label>
            <textarea value={pastedText} onChange={e => setPastedText(e.target.value)} placeholder="Paste article text..." className="input resize-none" rows={4} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Your angle / emphasis</label>
            <textarea value={userNotes} onChange={e => setUserNotes(e.target.value)}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); editor?.getText() ? handleRevision() : handleGenerate() } }}
              placeholder="Focus on the N2 polarization mechanism..." className="input resize-none" rows={3} />
            <p className="text-xs text-text-dim mt-1">Cmd+Enter to generate</p>
          </div>
        </div>
        <div className="p-4 border-t border-border space-y-2 flex-shrink-0">
          <button onClick={handleGenerate} disabled={isGenerating || (!url && !pastedText && !preview)} className="btn-primary w-full justify-center">
            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Generate Post
          </button>
          <button onClick={() => setSessionsOpen(true)} className="btn-ghost w-full justify-center text-xs">
            <Clock size={12} /> Recent sessions ({sessions.length})
          </button>
        </div>
      </div>

      {/* Editor Panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 p-3 border-b border-border flex-shrink-0">
          <input type="text" value={revisionInput} onChange={e => setRevisionInput(e.target.value)}
            placeholder="Request a revision... (Cmd+Enter)" className="input flex-1"
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleRevision() } }} />
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
              <div className="flex flex-col items-center gap-3"><Loader2 size={24} className="animate-spin text-accent" /><span className="text-sm text-text-muted">Generating...</span></div>
            </div>
          )}
          <div className="tiptap-editor p-4"><EditorContent editor={editor} /></div>
        </div>
      </div>

      {/* History Drawer */}
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

      {/* Regenerate Modal */}
      {regenerateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card p-6 w-80 space-y-4">
            <h3 className="text-sm font-semibold">Regenerate post</h3>
            <div className="space-y-2">
              <button onClick={() => handleRegenerateOption(true)} className="btn-secondary w-full justify-start text-left gap-3">
                <RotateCcw size={14} />
                <div><div className="font-medium">Start fresh</div><div className="text-xs text-text-dim">Clear conversation, generate from source</div></div>
              </button>
              <button onClick={() => handleRegenerateOption(false)} className="btn-secondary w-full justify-start text-left gap-3">
                <RefreshCw size={14} />
                <div><div className="font-medium">Ask LLM to try again</div><div className="text-xs text-text-dim">Keep conversation, request new version</div></div>
              </button>
            </div>
            <button onClick={() => setRegenerateModalOpen(false)} className="btn-ghost w-full justify-center text-xs">Cancel</button>
          </div>
        </div>
      )}

      {/* Sessions Modal */}
      {sessionsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card w-96 max-h-96 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-semibold">Recent Sessions</h3>
              <button onClick={() => setSessionsOpen(false)} className="btn-ghost p-1"><X size={14} /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sessions.length === 0 && <p className="p-4 text-xs text-text-dim">No saved sessions</p>}
              {sessions.map(s => (
                <button key={s.id} onClick={() => loadSession(s)} className="w-full text-left p-3 hover:bg-surface-2 border-b border-border/50 transition-colors">
                  <div className="text-sm text-text truncate">{s.paperTitle || 'Untitled'}</div>
                  <div className="text-xs text-text-dim">{new Date(s.updatedAt).toLocaleDateString()}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
