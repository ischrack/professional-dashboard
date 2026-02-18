import React, { useState, useEffect, useRef } from 'react'
import { RefreshCw, ExternalLink, ChevronDown, ChevronRight, AlertCircle, Loader2, Globe, FileDown } from 'lucide-react'
import clsx from 'clsx'
import type { InterviewBrief, Job, SearchEvent } from '@shared/types'
import CollapsibleMarkdown from './CollapsibleMarkdown'
import { useToast } from '../../../shared/hooks/useToast'

const SEARCH_STATUS_MESSAGES: Record<string, string[]> = {
  'company overview': ['Searching for company overview...', 'Looking up company news...', 'Researching company details...'],
  'pubmed': ['Searching PubMed for publications...', 'Finding scientific publications...'],
  'pipeline': ['Searching for pipeline programs...', 'Looking up clinical trials...'],
  'glassdoor': ['Searching interview intelligence...', 'Looking up Glassdoor reviews...'],
  'competitor': ['Researching competitive landscape...', 'Finding competitors...'],
  'linkedin': ['Searching LinkedIn for team info...'],
  default: ['Searching the web...', 'Gathering information...', 'Researching...'],
}

function getSearchMessage(query: string | null): string {
  if (!query) return 'Searching...'
  const q = query.toLowerCase()
  for (const [key, msgs] of Object.entries(SEARCH_STATUS_MESSAGES)) {
    if (key !== 'default' && q.includes(key)) return msgs[Math.floor(Math.random() * msgs.length)]
  }
  return `Searching for "${query.slice(0, 40)}${query.length > 40 ? '...' : ''}"`
}

interface DepthSelectionProps {
  defaultDepth: 'quick' | 'deep' | 'always_ask'
  onSelect: (depth: 'quick' | 'deep') => void
}

function DepthSelection({ defaultDepth, onSelect }: DepthSelectionProps) {
  const [selected, setSelected] = useState<'quick' | 'deep'>(defaultDepth === 'always_ask' ? 'quick' : defaultDepth as 'quick' | 'deep')

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 max-w-xl mx-auto">
      <h3 className="text-base font-semibold text-text mb-1">Research This Company</h3>
      <p className="text-sm text-text-dim mb-6 text-center">
        Choose how deeply to research the company, role, and competitive landscape.
      </p>
      <div className="grid grid-cols-2 gap-3 w-full mb-6">
        {([
          {
            id: 'quick' as const,
            label: 'Quick Brief',
            time: '~2 min',
            description: 'Company overview, key news, competitive landscape, and interview intelligence. Essentials only.',
          },
          {
            id: 'deep' as const,
            label: 'Deep Research',
            time: '5–10 min',
            description: 'Everything in Quick Brief plus pipeline details, publications, division context, and more citations.',
          },
        ] as const).map(opt => (
          <button
            key={opt.id}
            onClick={() => setSelected(opt.id)}
            className={clsx(
              'p-4 rounded-lg border-2 text-left transition-colors',
              selected === opt.id
                ? 'border-accent bg-accent/10'
                : 'border-border hover:border-border/80 hover:bg-surface-2'
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-sm text-text">{opt.label}</span>
              <span className="text-xs text-text-dim">{opt.time}</span>
            </div>
            <p className="text-xs text-text-dim leading-relaxed">{opt.description}</p>
          </button>
        ))}
      </div>
      <button
        onClick={() => onSelect(selected)}
        className="btn-primary"
      >
        Start Research
      </button>
    </div>
  )
}

interface ResearchingProps {
  searchStatus: string
  tokensSoFar: number
}

function ResearchingView({ searchStatus, tokensSoFar }: ResearchingProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <Loader2 size={32} className="animate-spin text-accent" />
      <div className="text-center">
        <p className="text-sm font-medium text-text">{searchStatus}</p>
        {tokensSoFar > 50 && (
          <p className="text-xs text-text-dim mt-1">Writing brief... ({Math.floor(tokensSoFar / 100) * 100}+ words)</p>
        )}
      </div>
    </div>
  )
}

interface BriefViewProps {
  brief: InterviewBrief
  job: Job
  onRerun: () => void
}

function BriefView({ brief, job, onRerun }: BriefViewProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [confirmRerun, setConfirmRerun] = useState(false)

  return (
    <div className="flex flex-col h-full">
      {/* Brief header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-border flex-shrink-0 gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-text">{job.company}</span>
            <span className="text-xs text-text-dim">—</span>
            <span className="text-xs text-text-dim truncate">{job.title}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className={clsx('badge text-[10px]', brief.depth === 'deep' ? 'badge-accent' : 'badge-gray')}>
              {brief.depth === 'deep' ? 'Deep Research' : 'Quick Brief'}
            </span>
            <span className="text-[10px] text-text-dim">{new Date(brief.updatedAt).toLocaleDateString()}</span>
            {brief.searchCount > 0 && (
              <span className="text-[10px] text-text-dim flex items-center gap-1">
                <Globe size={10} />{brief.searchCount} searches
              </span>
            )}
            {brief.partial && (
              <span className="text-[10px] text-warning flex items-center gap-1">
                <AlertCircle size={10} />Partial
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {confirmRerun ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-dim">Re-run and overwrite?</span>
              <button onClick={onRerun} className="btn-danger text-xs">Yes, re-run</button>
              <button onClick={() => setConfirmRerun(false)} className="btn-ghost text-xs">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmRerun(true)} className="btn-ghost text-xs flex items-center gap-1">
              <RefreshCw size={12} />Re-run Research
            </button>
          )}
        </div>
      </div>

      {brief.partial && (
        <div className="mx-4 mt-3 p-3 bg-warning/10 border border-warning/30 rounded-lg flex items-start gap-2">
          <AlertCircle size={14} className="text-warning flex-shrink-0 mt-0.5" />
          <p className="text-xs text-warning">Some searches failed during generation. This brief may be incomplete. Re-run research to get a complete brief.</p>
        </div>
      )}

      {/* Brief content */}
      <div className="flex-1 overflow-y-auto p-4">
        <CollapsibleMarkdown content={brief.content} />

        {/* Sources */}
        {brief.sources.length > 0 && (
          <div className="mt-4 border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setSourcesOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-2 transition-colors"
            >
              <span className="text-xs font-semibold text-text-dim">Sources ({brief.sources.length})</span>
              {sourcesOpen ? <ChevronDown size={14} className="text-text-dim" /> : <ChevronRight size={14} className="text-text-dim" />}
            </button>
            {sourcesOpen && (
              <div className="px-4 pb-3 pt-1 space-y-1">
                {brief.sources.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => window.api.openExternal(url)}
                    className="flex items-center gap-1.5 text-xs text-accent hover:underline w-full text-left truncate"
                  >
                    <ExternalLink size={10} className="flex-shrink-0" />
                    <span className="truncate">{url}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Export button */}
      <div className="px-4 pb-3 flex-shrink-0 border-t border-border pt-3">
        <button
          onClick={() => window.api.openExternal('about:blank')} // placeholder — PDF export TBD
          className="btn-ghost text-xs flex items-center gap-1.5"
          title="PDF export requires Puppeteer/jsPDF integration (see build notes)"
          disabled
        >
          <FileDown size={13} />Export Brief as PDF
        </button>
      </div>
    </div>
  )
}

interface ResearchBriefProps {
  job: Job
  brief: InterviewBrief | null
  onBriefReady: (brief: InterviewBrief) => void
  settings: Record<string, unknown>
}

export default function ResearchBrief({ job, brief, onBriefReady, settings }: ResearchBriefProps) {
  const { toast } = useToast()
  const [phase, setPhase] = useState<'depth_select' | 'researching' | 'done'>(
    brief ? 'done' : 'depth_select'
  )
  const [searchStatus, setSearchStatus] = useState('Starting research...')
  const [tokensSoFar, setTokensSoFar] = useState(0)
  const [currentBrief, setCurrentBrief] = useState<InterviewBrief | null>(brief)
  const cleanupRef = useRef<(() => void)[]>([])

  useEffect(() => {
    setCurrentBrief(brief)
    setPhase(brief ? 'done' : 'depth_select')
  }, [brief?.id])

  useEffect(() => {
    return () => {
      cleanupRef.current.forEach(fn => fn())
      cleanupRef.current = []
    }
  }, [])

  async function startResearch(depth: 'quick' | 'deep') {
    setPhase('researching')
    setTokensSoFar(0)
    setSearchStatus('Starting research...')

    // Clean up any previous listeners
    cleanupRef.current.forEach(fn => fn())
    cleanupRef.current = []

    // Build context about the job
    const models = (settings.models as Record<string, string>) || {}
    const model = models.interviewResearch || 'claude-opus-4-6'
    const provider: 'anthropic' | 'openai' = model.startsWith('gpt') ? 'openai' : 'anthropic'

    const systemPrompt = buildResearchSystemPrompt(job, depth)
    const messages = [{ role: 'user' as const, content: `Please research ${job.company} for the role: ${job.title}. ${depth === 'deep' ? 'Perform thorough research with multiple searches.' : 'Provide a quick but comprehensive overview.'}` }]

    // Register listeners
    const unToken = window.api.onInterviewToken((token: string) => {
      setTokensSoFar(n => n + token.split(/\s+/).length)
    })
    const unSearch = window.api.onInterviewSearchEvent((evt: Record<string, unknown>) => {
      const e = evt as SearchEvent
      if (e.type === 'search_start') {
        setSearchStatus(getSearchMessage(e.query))
      } else if (e.type === 'search_complete') {
        setSearchStatus('Synthesizing results...')
      }
    })
    const unDone = window.api.onInterviewResearchDone((result: Record<string, unknown>) => {
      const b = (result as { brief: InterviewBrief }).brief
      setCurrentBrief(b)
      setPhase('done')
      onBriefReady(b)
      window.dispatchEvent(new CustomEvent('interview-session-changed'))
    })
    const unError = window.api.onInterviewStreamError((err: string) => {
      toast('error', `Research failed: ${err}`)
      setPhase('depth_select')
    })

    cleanupRef.current = [unToken, unSearch, unDone, unError]

    window.api.interviewStartResearch({ jobId: job.id, depth, model, provider, systemPrompt, messages })
  }

  function handleRerun() {
    setCurrentBrief(null)
    setPhase('depth_select')
  }

  if (phase === 'depth_select') {
    const depthSetting = (settings.interviewResearchDepth as string) || 'always_ask'
    return (
      <DepthSelection
        defaultDepth={depthSetting as 'quick' | 'deep' | 'always_ask'}
        onSelect={startResearch}
      />
    )
  }

  if (phase === 'researching') {
    return <ResearchingView searchStatus={searchStatus} tokensSoFar={tokensSoFar} />
  }

  if (currentBrief) {
    return <BriefView brief={currentBrief} job={job} onRerun={handleRerun} />
  }

  return null
}

function buildResearchSystemPrompt(job: Job, depth: 'quick' | 'deep'): string {
  const description = job.description ? `\n\nJob Description:\n${job.description.slice(0, 3000)}` : ''
  const depthInstructions = depth === 'deep'
    ? 'Perform thorough, multi-search research. Use at least 5–8 web searches across different topics. Include citations and sources. Search PubMed for relevant publications if biotech/pharma. Search ClinicalTrials.gov if applicable.'
    : 'Perform focused research using 2–4 targeted web searches. Cover the essentials efficiently.'

  return `You are a professional interview research assistant. Your task is to research a company and role to help a candidate prepare for a job interview.

${depthInstructions}

Research and synthesize a structured brief covering:

## Company Overview
- Mission, vision, and stated values
- Company size, funding stage or public status, recent financial news
- Recent news (past 6 months): acquisitions, partnerships, leadership changes, layoffs, expansions
- Primary products, platforms, or therapeutic areas

## Division / Team Context
(Only include if inferable from the job posting)
- The specific division, department, or team
- Known leadership
- Recent work or announcements from that team

## Scientific / Pipeline Relevance
(For biotech/pharma roles)
- Active pipeline programs relevant to the role
- Recent publications from company scientists
- Key platform technologies

## Competitive Landscape
- Primary competitors in this specific space
- How the company differentiates from competitors
- Notable recent competitive dynamics

## Interview Intelligence
- Publicly available information about the company's interview process
- Commonly reported values or competencies emphasized in hiring

Use web search to find the most current and accurate information. Write in a concise, factual style. Use markdown formatting with clear section headers.

Company: ${job.company}
Role: ${job.title}${job.location ? `\nLocation: ${job.location}` : ''}${description}`
}
