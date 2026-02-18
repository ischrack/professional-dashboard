import React, { useState, useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Send, Loader2, Download, Copy, RefreshCw, Globe } from 'lucide-react'
import type { Job, ResumeBase, ChatMessage } from '@shared/types'
import { useToast } from '../../shared/hooks/useToast'

const RESUME_SYSTEM = `You are an expert resume writer specializing in biomedical and life sciences roles.
Generate a tailored, ATS-friendly resume. Requirements:
- No tables, text boxes, or graphics — use standard paragraph styles only
- Sections: Summary, Experience, Skills, Education, Publications
- Keywords from the job description woven in naturally
- Strong action verbs, quantified impact where possible
- IMPORTANT: Do NOT modify the Publications section. Copy it exactly from the base resume.`

const COVER_LETTER_SYSTEM = `You are an expert cover letter writer for biomedical/life sciences professionals.
Write a concise, compelling cover letter (3-4 paragraphs). Requirements:
- Avoid generic openers ("I am writing to apply for...")
- Reference 1-2 specific things about the company from the research provided
- Specific to this role and company
- Professional but personable tone
- No fluff — every sentence should add value`

const RECRUITER_SYSTEM = `You are writing a direct LinkedIn message or email to a recruiter or hiring manager.
Requirements:
- 150-250 words
- Professional and direct
- Open with: "Hi [Name],"
- Brief intro, specific interest in this role, one key relevant qualification
- Clear call to action`

type MaterialType = 'resume' | 'cover_letter' | 'recruiter_message'

const SYSTEM_PROMPTS: Record<MaterialType, string> = {
  resume: RESUME_SYSTEM,
  cover_letter: COVER_LETTER_SYSTEM,
  recruiter_message: RECRUITER_SYSTEM,
}

const TYPE_LABELS: Record<MaterialType, string> = {
  resume: 'Resume',
  cover_letter: 'Cover Letter',
  recruiter_message: 'Recruiter Message',
}

interface Props {
  job: Job
  type: MaterialType
}

export default function MaterialEditor({ job, type }: Props) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [revision, setRevision] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [resumeBases, setResumeBases] = useState<ResumeBase[]>([])
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [charCount, setCharCount] = useState(0)
  const [charLimit, setCharLimit] = useState(300)

  // Cover letter company research
  const [companyResearch, setCompanyResearch] = useState(job.companyResearch || '')
  const [researchExpanded, setResearchExpanded] = useState(false)
  const [fetchingResearch, setFetchingResearch] = useState(false)
  const [showResearchEdit, setShowResearchEdit] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: `${TYPE_LABELS[type]} will appear here after generation...` }),
    ],
    editorProps: { attributes: { class: 'tiptap-editor' } },
    onUpdate: ({ editor }) => {
      setCharCount(editor.getText().length)
    },
  })

  useEffect(() => {
    loadData()
  }, [job.id, type])

  async function loadData() {
    const [bases, s, mat] = await Promise.all([
      window.api.getResumeBases() as Promise<ResumeBase[]>,
      window.api.getSettings() as Promise<Record<string, unknown>>,
      window.api.jobGetMaterial(job.id, type) as Promise<(typeof messages extends infer M ? M : never) & { content?: string; messages?: ChatMessage[] } | null>,
    ])
    setResumeBases(bases)
    setSettings(s)
    if (mat?.content) {
      editor?.commands.setContent(`<p>${mat.content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`)
      setMessages(mat.messages || [])
    }
  }

  async function getBaseResumeContent(): Promise<{ baseId: number; content: string } | null> {
    if (!resumeBases.length) {
      toast('error', 'No resume bases configured. Please add one in Settings.')
      return null
    }
    if (resumeBases.length === 1) return { baseId: resumeBases[0].id, content: resumeBases[0].content }

    // Modal-like: we'll use a simple inline select for now
    return new Promise((resolve) => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <div style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6)">
          <div style="background:#252525;border:1px solid #3a3a3a;border-radius:12px;padding:20px;width:320px;space-y:12px">
            <p style="color:#e8e8e8;font-size:14px;font-weight:600;margin-bottom:12px">Select resume base</p>
            ${resumeBases.map(b => `<button data-id="${b.id}" data-content="${encodeURIComponent(b.content)}" style="display:block;width:100%;text-align:left;padding:8px 12px;margin:4px 0;background:#2e2e2e;border:1px solid #3a3a3a;border-radius:8px;color:#e8e8e8;font-size:13px;cursor:pointer">${b.name}</button>`).join('')}
            <button id="cancel-base" style="display:block;width:100%;text-align:center;padding:8px;margin-top:8px;background:transparent;border:none;color:#6b6b6b;font-size:12px;cursor:pointer">Cancel</button>
          </div>
        </div>`
      document.body.appendChild(modal)
      modal.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('button[data-id]') as HTMLElement
        if (btn) {
          const id = parseInt(btn.dataset.id!)
          const content = decodeURIComponent(btn.dataset.content!)
          document.body.removeChild(modal)
          resolve({ baseId: id, content })
        } else if ((e.target as HTMLElement).id === 'cancel-base') {
          document.body.removeChild(modal)
          resolve(null)
        }
      })
    })
  }

  async function fetchCompanyResearch() {
    setFetchingResearch(true)
    try {
      const result = await window.api.jobFetchCompanyPage(job.company) as { success?: boolean; text?: string; error?: string }
      if (result.success && result.text) {
        setCompanyResearch(result.text)
        setShowResearchEdit(true)
        setResearchExpanded(true)
        // Save to job record
        await window.api.jobUpdate(job.id, { companyResearch: result.text })
      } else {
        toast('error', result.error || 'Could not fetch company page')
        setShowResearchEdit(true)
      }
    } catch (err) {
      toast('error', String(err))
      setShowResearchEdit(true)
    } finally {
      setFetchingResearch(false)
    }
  }

  async function handleGenerate() {
    setIsGenerating(true)
    try {
      let userContent = ''
      let baseResumeId: number | undefined

      if (type === 'resume') {
        const base = await getBaseResumeContent()
        if (!base) { setIsGenerating(false); return }
        baseResumeId = base.baseId
        userContent = `Job Title: ${job.title}\nCompany: ${job.company}\nJob Description:\n${job.description || 'Not available'}\n\nBase Resume:\n${base.content}`
      } else if (type === 'cover_letter') {
        const base = await getBaseResumeContent()
        if (!base) { setIsGenerating(false); return }
        baseResumeId = base.baseId

        // Fetch/confirm company research
        if (!companyResearch && !showResearchEdit) {
          await fetchCompanyResearch()
          setIsGenerating(false)
          return // User needs to review research before generating
        }

        userContent = `Job Title: ${job.title}\nCompany: ${job.company}\n\nCompany Research:\n${companyResearch || 'Not available'}\n\nJob Description:\n${job.description || 'Not available'}\n\nBase Resume:\n${base.content}`
      } else {
        // Recruiter message
        const base = resumeBases[0] // Use first base for context
        userContent = `Write a recruiter message for this role:\nJob: ${job.title} at ${job.company}\n${job.location ? `Location: ${job.location}` : ''}\n\nJob Description:\n${job.description || 'Not available'}\n\nCandidate background summary:\n${base?.content?.slice(0, 2000) || 'Not available'}`
      }

      const models = settings.models as Record<string, string> || {}
      const modelKey = type === 'resume' ? 'resumeGenerator' : type === 'cover_letter' ? 'coverLetterGenerator' : 'qaGenerator'
      const model = models[modelKey] || 'claude-sonnet-4-6'
      const provider = model.startsWith('gpt') ? 'openai' : 'anthropic'

      const newMessages: ChatMessage[] = [{ role: 'user', content: userContent }]
      setMessages(newMessages)

      const result = await window.api.llmCall({
        provider, model, messages: newMessages, systemPrompt: SYSTEM_PROMPTS[type],
      }) as { content: string }

      editor?.commands.setContent(`<p>${result.content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`)
      const updatedMessages: ChatMessage[] = [...newMessages, { role: 'assistant', content: result.content }]
      setMessages(updatedMessages)

      await window.api.jobSaveMaterial({
        jobId: job.id,
        type,
        content: result.content,
        messages: updatedMessages,
        baseResumeId,
      })
    } catch (err) {
      toast('error', String(err), true)
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleRevision() {
    if (!revision.trim()) return
    setIsGenerating(true)
    const currentText = editor?.getText() || ''
    const newMessages: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: currentText },
      { role: 'user', content: revision },
    ]
    setMessages(newMessages)
    setRevision('')

    try {
      const models = settings.models as Record<string, string> || {}
      const modelKey = type === 'resume' ? 'resumeGenerator' : type === 'cover_letter' ? 'coverLetterGenerator' : 'qaGenerator'
      const model = models[modelKey] || 'claude-sonnet-4-6'
      const provider = model.startsWith('gpt') ? 'openai' : 'anthropic'

      const result = await window.api.llmCall({
        provider, model, messages: newMessages, systemPrompt: SYSTEM_PROMPTS[type],
      }) as { content: string }

      editor?.commands.setContent(`<p>${result.content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`)
      const updatedMessages: ChatMessage[] = [...newMessages, { role: 'assistant', content: result.content }]
      setMessages(updatedMessages)
      await window.api.jobSaveMaterial({ jobId: job.id, type, content: result.content, messages: updatedMessages })
    } catch (err) {
      toast('error', String(err), true)
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleExportDocx() {
    if (!editor) return
    const lastName = 'User' // TODO: extract from resume base
    try {
      const result = await window.api.jobExportDocx(job.id, type, editor.getHTML(), lastName) as { success?: boolean; filePath?: string; dirPath?: string; error?: string }
      if (result.success) {
        toast('success', `Saved to: ${result.filePath}`)
      } else {
        toast('error', result.error || 'Export failed')
      }
    } catch (err) {
      toast('error', String(err))
    }
  }

  function handleCopy() {
    if (!editor) return
    const text = editor.getText()
    navigator.clipboard.writeText(text)
    toast('success', 'Copied to clipboard')
  }

  const isRecruiter = type === 'recruiter_message'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Cover letter research banner */}
      {type === 'cover_letter' && (
        <div className="border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-xs font-medium text-text-muted">Company Research</span>
            <button
              onClick={() => companyResearch ? setResearchExpanded(!researchExpanded) : fetchCompanyResearch()}
              disabled={fetchingResearch}
              className="btn-ghost text-xs py-0.5"
            >
              {fetchingResearch ? <Loader2 size={11} className="animate-spin" /> : <Globe size={11} />}
              {companyResearch ? (researchExpanded ? 'Hide' : 'Show & Edit') : 'Fetch Company Info'}
            </button>
            {companyResearch && !researchExpanded && (
              <span className="text-xs text-success">✓ Research ready</span>
            )}
          </div>
          {researchExpanded && (
            <div className="px-3 pb-3">
              <textarea
                value={companyResearch}
                onChange={e => setCompanyResearch(e.target.value)}
                placeholder="Company research will appear here. Edit before generating."
                className="input resize-none text-xs"
                rows={5}
              />
              <div className="flex gap-2 mt-1.5">
                <button onClick={fetchCompanyResearch} disabled={fetchingResearch} className="btn-secondary text-xs py-1">
                  {fetchingResearch ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Re-fetch
                </button>
                <button onClick={() => { setResearchExpanded(false); setShowResearchEdit(true) }} className="btn-ghost text-xs py-1">
                  Done editing
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-border flex-shrink-0">
        <button onClick={handleGenerate} disabled={isGenerating} className="btn-primary text-xs">
          {isGenerating ? <Loader2 size={12} className="animate-spin" /> : null}
          Generate {TYPE_LABELS[type]}
        </button>
        <div className="flex-1">
          <input
            value={revision}
            onChange={e => setRevision(e.target.value)}
            placeholder="Request a revision..."
            className="input text-xs py-1"
            onKeyDown={e => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && handleRevision()}
          />
        </div>
        <button onClick={handleRevision} disabled={!revision || isGenerating} className="btn-secondary text-xs p-1.5">
          <Send size={13} />
        </button>
        <button onClick={handleCopy} className="btn-ghost text-xs p-1.5" title="Copy">
          <Copy size={13} />
        </button>
        {!isRecruiter && (
          <button onClick={handleExportDocx} className="btn-ghost text-xs p-1.5" title="Export .docx">
            <Download size={13} />
          </button>
        )}
      </div>

      {/* Character counter for recruiter message */}
      {isRecruiter && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border/50 flex-shrink-0">
          <span className={`text-xs font-mono ${charCount > charLimit ? 'text-error' : 'text-text-muted'}`}>
            {charCount} / {charLimit} chars
          </span>
          <input
            type="number"
            value={charLimit}
            onChange={e => setCharLimit(parseInt(e.target.value) || 300)}
            className="input text-xs py-0.5 w-20"
            min={50}
            max={2000}
          />
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-y-auto relative">
        {isGenerating && (
          <div className="absolute inset-0 z-10 bg-bg/80 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={22} className="animate-spin text-accent" />
              <span className="text-sm text-text-muted">Generating...</span>
            </div>
          </div>
        )}
        <div className="tiptap-editor">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
