import React, { useState, useEffect } from 'react'
import {
  FileText, Mail, MessageSquare, HelpCircle, StickyNote,
  CheckCircle, Globe, Mic2, RefreshCw, Loader2, Trash2, AlertTriangle,
  Crosshair, Copy, X, Highlighter, ThumbsUp
} from 'lucide-react'
import clsx from 'clsx'
import type { Job } from '@shared/types'
import { useToast } from '../../shared/hooks/useToast'
import { STATUS_CONFIG, TRACKER_STATUSES } from '../../shared/utils/statusConfig'
import MaterialEditor from './MaterialEditor'
import QATab from './QATab'
import NotesTab from './NotesTab'
import MarkAppliedModal from './MarkAppliedModal'
import InterviewPrepTab from './interview/InterviewPrepTab'

type Tab = 'resume' | 'cover_letter' | 'recruiter_message' | 'qa' | 'notes' | 'interview'

type CaptureEntry = {
  selectedText?: string
  chain?: { tag: string; id: string; classes: string; selector: string; fullText: string }[]
  selectors?: string[]
  expandButtons?: { text: string; selector: string; ariaLabel: string }[]
  url?: string
  error?: string
}

type CaptureReport = CaptureEntry[]

interface Props {
  job: Job
  onJobUpdated: () => Promise<void>
  onJobDeleted: () => Promise<void>
  initialTab?: Tab
  onCompareFocusChange?: (focused: boolean) => void
}

export default function ApplicationWorkspace({ job, onJobUpdated, onJobDeleted, initialTab, onCompareFocusChange }: Props) {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'resume')
  const [isResumeCompareFocused, setIsResumeCompareFocused] = useState(false)
  const [markAppliedOpen, setMarkAppliedOpen] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [tracking, setTracking] = useState(false)
  const [manualEnriching, setManualEnriching] = useState(false)
  const [captureReport, setCaptureReport] = useState<CaptureReport | null>(null)

  useEffect(() => {
    const unsub = window.api.onLinkedinCaptureResult((report) => {
      setTracking(false)
      const log = report as CaptureReport
      if (log.length > 0) setCaptureReport(log)  // only open modal when there are captures
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = window.api.onLinkedinManualEnrichResult(async (result) => {
      const r = result as { jobId: number; text: string; chain: unknown[]; selectors: string[]; url: string; error?: string }
      setManualEnriching(false)
      if (r.error) { toast('error', r.error); return }
      if (r.jobId !== job.id) return
      try {
        await window.api.jobUpdate(r.jobId, { description: r.text, status: 'no_response' })
        let urlPattern = ''
        try { urlPattern = new URL(r.url).hostname } catch { /* ignore */ }
        await window.api.patternSave({
          jobId: r.jobId,
          url: r.url,
          urlPattern,
          fieldType: 'description',
          selectedText: r.text.slice(0, 500),
          chainJson: JSON.stringify(r.chain),
          selectorsJson: JSON.stringify(r.selectors),
          source: 'manual_enrich',
        })
        await onJobUpdated()
        toast('success', 'Description saved from manual highlight')
      } catch (err) { toast('error', String(err)) }
    })
    return unsub
  }, [job.id])

  useEffect(() => {
    onCompareFocusChange?.(isResumeCompareFocused)
  }, [isResumeCompareFocused, onCompareFocusChange])

  useEffect(() => {
    if (activeTab === 'resume') return
    setIsResumeCompareFocused(false)
  }, [activeTab])

  useEffect(() => {
    return () => {
      onCompareFocusChange?.(false)
    }
  }, [onCompareFocusChange])

  const cfg = STATUS_CONFIG[job.status]

  async function handleEnrich() {
    if (!job.url) { toast('error', 'No URL — add a posting URL to enrich'); return }
    setEnriching(true)
    try {
      const raw = await window.api.jobEnrich([job.id]) as Record<string, unknown>
      if (raw && 'error' in raw) { toast('error', raw.error as string); return }
      const results = raw as Record<number, { success: boolean; error?: string }>
      const r = results[job.id]
      if (r?.success) {
        toast('success', 'Job enriched')
        await onJobUpdated()
      } else {
        const errMsg = r?.error || 'Enrichment failed'
        toast('error', errMsg)
        if (errMsg.includes('authentication required')) {
          window.api.showLinkedInBrowser()
        }
        await onJobUpdated()
      }
    } catch (err) { toast('error', String(err)) }
    finally { setEnriching(false) }
  }

  async function handleDelete() {
    await window.api.jobDelete(job.id)
    toast('success', 'Job deleted')
    await onJobDeleted()
  }

  // Status update
  async function handleStatusChange(status: string) {
    await window.api.jobUpdate(job.id, { status })
    await onJobUpdated()
    toast('success', `Status updated to: ${STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.label || status}`)
  }

  const tabs: { id: Tab; icon: React.ElementType; label: string }[] = [
    { id: 'resume', icon: FileText, label: 'Resume' },
    { id: 'cover_letter', icon: Mail, label: 'Cover Letter' },
    { id: 'recruiter_message', icon: MessageSquare, label: 'Recruiter' },
    { id: 'qa', icon: HelpCircle, label: 'Q&A' },
    { id: 'notes', icon: StickyNote, label: 'Notes' },
    { id: 'interview', icon: Mic2, label: 'Interview Prep' },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Job header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-text truncate">{job.title}</h2>
            <span className="text-text-dim">at</span>
            <span className="text-sm font-semibold text-accent truncate">{job.company}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {job.location && <span className="text-xs text-text-dim">{job.location}</span>}
            {job.remote && <span className="badge badge-gray text-[10px]">{job.remote}</span>}
            {job.salary && <span className="text-xs text-text-muted">{job.salary}</span>}
            {job.url && (
              <button
                onClick={() => job.url?.includes('linkedin.com')
                  ? window.api.linkedinOpenUrl(job.url!)
                  : window.api.openExternal(job.url!)
                }
                className="text-xs text-accent hover:underline flex items-center gap-1"
              >
                <Globe size={11} />View posting
              </button>
            )}
          </div>
        </div>

        {/* Status dropdown + Enrich + Delete */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleEnrich}
            disabled={enriching || !job.url}
            className="btn-ghost text-xs flex items-center gap-1.5"
            title={job.url ? 'Fetch job details from LinkedIn' : 'No URL set'}
          >
            {enriching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {enriching ? 'Enriching…' : 'Enrich'}
          </button>
          <button
            onClick={async () => {
              if (!job.url) return
              setManualEnriching(true)
              await window.api.linkedinOpenUrl(job.url)
              await new Promise(r => setTimeout(r, 500))
              await window.api.linkedinSetManualEnrich(job.id)
            }}
            disabled={manualEnriching || enriching || !job.url}
            className="btn-ghost text-xs flex items-center gap-1.5"
            title={job.url ? 'Open job in browser — highlight description to save it' : 'No URL set'}
          >
            <Highlighter size={13} />
            {manualEnriching ? 'Waiting…' : 'Manually'}
          </button>
          <button
            onClick={async () => {
              if (!job.url) return
              setTracking(true)
              await window.api.linkedinOpenUrl(job.url)
              await new Promise(r => setTimeout(r, 500))
              await window.api.linkedinSetTrackMode(true)
            }}
            disabled={tracking || !job.url}
            className="btn-ghost text-xs flex items-center gap-1.5"
            title={job.url ? 'Open job in browser to capture DOM selectors' : 'No URL set'}
          >
            <Crosshair size={13} />
            {tracking ? 'Tracking…' : 'Track'}
          </button>
          {deleteConfirm ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-warning flex items-center gap-1">
                <AlertTriangle size={11} />Delete?
              </span>
              <button
                onClick={handleDelete}
                className="btn-ghost text-xs text-error hover:text-error px-2 py-1"
              >
                Yes
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="btn-ghost text-xs px-2 py-1"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setDeleteConfirm(true)}
              className="btn-ghost p-1.5 text-text-dim hover:text-error"
              title="Delete job"
            >
              <Trash2 size={13} />
            </button>
          )}
          <select
            value={job.status}
            onChange={e => handleStatusChange(e.target.value)}
            className="input text-xs py-1 w-auto"
            style={{ color: cfg.color }}
          >
            {TRACKER_STATUSES.map(s => (
              <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
            ))}
          </select>

          {!job.appliedAt ? (
            <button onClick={() => setMarkAppliedOpen(true)} className="btn-primary text-xs">
              <CheckCircle size={13} />
              Mark as Applied
            </button>
          ) : (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle size={12} />Applied {new Date(job.appliedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Split: Job description left | Materials right */}
      <div className="flex flex-1 overflow-hidden">
        {/* Job description */}
        {!isResumeCompareFocused && (
          <div className="w-80 border-r border-border flex flex-col flex-shrink-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-text-dim uppercase tracking-wider">Job Description</span>
            {job.description && (
              <button
                onClick={async () => {
                  try {
                    let urlPattern = ''
                    try { urlPattern = job.url ? new URL(job.url).hostname : '' } catch { /* ignore */ }
                    await window.api.patternSave({
                      jobId: job.id,
                      url: job.url ?? null,
                      urlPattern,
                      fieldType: 'description',
                      selectedText: (job.description ?? '').slice(0, 500),
                      chainJson: null,
                      selectorsJson: null,
                      source: 'confirmed',
                    })
                    toast('success', 'Description confirmed and saved to pattern repository')
                  } catch (err) { toast('error', String(err)) }
                }}
                className="btn-ghost p-1 text-text-dim hover:text-success"
                title="Confirm this description is correct — saves to pattern repository"
              >
                <ThumbsUp size={12} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {job.description ? (
              <div className="space-y-2">
                {job.description.split('\n').filter(l => l.trim()).map((line, i) => (
                  <p key={i} className="text-xs text-text-muted leading-relaxed">{line.trim()}</p>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-24 text-text-dim gap-1">
                {job.status === 'enrichment_failed' ? (
                  <>
                    <p className="text-xs text-center text-warning">Enrichment failed</p>
                    <p className="text-[10px] text-center opacity-70">LinkedIn login may be required.</p>
                    <button
                      onClick={() => window.api.showLinkedInBrowser()}
                      className="text-[10px] text-accent hover:underline mt-1"
                    >
                      Open LinkedIn browser →
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-center">No description yet</p>
                    <p className="text-[10px] opacity-60">Click Enrich to fetch details</p>
                  </>
                )}
              </div>
            )}
          </div>
          </div>
        )}

        {/* Materials panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-border flex-shrink-0">
            {tabs.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={clsx('tab flex items-center gap-1.5', activeTab === id && 'tab-active')}
              >
                <Icon size={13} />{label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {(activeTab === 'resume' || activeTab === 'cover_letter' || activeTab === 'recruiter_message') && (
              <MaterialEditor
                key={`${job.id}:${activeTab}`}
                job={job}
                type={activeTab}
                onInlineCompareChange={(open) => {
                  if (activeTab !== 'resume') return
                  setIsResumeCompareFocused(open)
                }}
              />
            )}
            {activeTab === 'qa' && <QATab job={job} />}
            {activeTab === 'notes' && <NotesTab jobId={job.id} />}
            {activeTab === 'interview' && <InterviewPrepTab job={job} />}
          </div>
        </div>
      </div>

      {markAppliedOpen && (
        <MarkAppliedModal
          job={job}
          onClose={() => setMarkAppliedOpen(false)}
          onApplied={async () => {
            setMarkAppliedOpen(false)
            await onJobUpdated()
            toast('success', 'Logged as applied!')
          }}
        />
      )}

      {captureReport && (() => {
        // Deduplicate expand buttons across all entries
        const allExpand = captureReport.flatMap(e => e.expandButtons ?? [])
        const expandSeen = new Set<string>()
        const expandDeduped = allExpand.filter(b => {
          if (expandSeen.has(b.selector)) return false
          expandSeen.add(b.selector)
          return true
        })
        const pageUrl = captureReport.find(e => e.url)?.url

        const copyAll = () => {
          const lines: string[] = [`URL: ${pageUrl ?? 'unknown'}\n`]
          captureReport.forEach((entry, idx) => {
            lines.push(`--- Capture #${idx + 1} ---`)
            if (entry.error) {
              lines.push(`ERROR: ${entry.error}`)
            } else {
              lines.push(`Selected Text:\n"${entry.selectedText}"`)
              lines.push(`\nDOM Ancestry (innermost → outermost):`)
              entry.chain?.forEach(node => {
                lines.push(`  ${node.selector || node.tag}  "${node.fullText}"`)
              })
              if (entry.selectors?.length) {
                lines.push(`\nSelectors:`)
                entry.selectors.forEach(s => lines.push(`  ${s}`))
              }
            }
            lines.push('')
          })
          if (expandDeduped.length) {
            lines.push('--- Expand / Show More Buttons ---')
            expandDeduped.forEach(b => {
              lines.push(`  ${b.selector}  text:"${b.text}"${b.ariaLabel ? `  aria:"${b.ariaLabel}"` : ''}`)
            })
          }
          navigator.clipboard.writeText(lines.join('\n'))
        }

        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6" onClick={() => setCaptureReport(null)}>
            <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                <h3 className="text-sm font-semibold">Capture Report — {captureReport.length} capture{captureReport.length !== 1 ? 's' : ''}</h3>
                <button onClick={() => setCaptureReport(null)} className="btn-ghost p-1"><X size={14} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">

                {/* Individual captures */}
                {captureReport.map((entry, idx) => (
                  <div key={idx} className="border border-border rounded-lg p-3 space-y-3">
                    <p className="text-[10px] uppercase tracking-wider text-text-dim font-semibold">Capture #{idx + 1}</p>
                    {entry.error ? (
                      <p className="text-error">{entry.error}</p>
                    ) : (
                      <>
                        <section>
                          <p className="text-[10px] uppercase tracking-wider text-text-dim mb-1">Selected Text</p>
                          <p className="bg-surface-2 rounded p-2 text-text-muted font-mono leading-relaxed">"{entry.selectedText}"</p>
                        </section>
                        <section>
                          <p className="text-[10px] uppercase tracking-wider text-text-dim mb-1">DOM Ancestry (innermost → outermost)</p>
                          <div className="space-y-0.5 font-mono">
                            {entry.chain?.map((node, i) => (
                              <div key={i} className="flex items-baseline gap-2" style={{ paddingLeft: i * 14 }}>
                                <span className="text-accent flex-shrink-0">{node.selector || node.tag}</span>
                                {node.fullText && <span className="text-text-dim truncate">"{node.fullText}"</span>}
                              </div>
                            ))}
                          </div>
                        </section>
                        {(entry.selectors?.length ?? 0) > 0 && (
                          <section>
                            <p className="text-[10px] uppercase tracking-wider text-text-dim mb-1">Selectors</p>
                            <div className="space-y-1">
                              {entry.selectors!.map((sel, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <code className="bg-surface-2 rounded px-2 py-0.5 text-accent flex-1">{sel}</code>
                                  <button onClick={() => navigator.clipboard.writeText(sel)} className="btn-ghost p-1 text-text-dim" title="Copy"><Copy size={11} /></button>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}
                      </>
                    )}
                  </div>
                ))}

                {/* Expand / show-more buttons — deduplicated across all captures */}
                {expandDeduped.length > 0 && (
                  <div className="border border-border rounded-lg p-3 space-y-2" style={{ borderColor: 'rgba(251,191,36,0.4)' }}>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#fbbf24' }}>Expand / Show More Buttons Detected</p>
                    <div className="space-y-1.5">
                      {expandDeduped.map((btn, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <code className="bg-surface-2 rounded px-2 py-0.5 flex-1 font-mono" style={{ color: '#fbbf24' }}>{btn.selector}</code>
                          {btn.text && <span className="text-text-dim text-[10px] flex-shrink-0">"{btn.text}"</span>}
                          {btn.ariaLabel && <span className="text-text-dim text-[10px] flex-shrink-0 italic">[{btn.ariaLabel}]</span>}
                          <button onClick={() => navigator.clipboard.writeText(btn.selector)} className="btn-ghost p-1 text-text-dim flex-shrink-0" title="Copy"><Copy size={11} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Page URL */}
                {pageUrl && (
                  <section>
                    <p className="text-[10px] uppercase tracking-wider text-text-dim mb-1">Page URL</p>
                    <p className="font-mono text-text-dim text-[10px] break-all">{pageUrl}</p>
                  </section>
                )}

              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t border-border flex-shrink-0">
                <span className="text-[10px] text-text-dim">Paste the copied text into Claude Code to update the enrichment selectors</span>
                <button onClick={copyAll} className="btn-ghost text-xs flex items-center gap-1.5">
                  <Copy size={13} />Copy All
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
