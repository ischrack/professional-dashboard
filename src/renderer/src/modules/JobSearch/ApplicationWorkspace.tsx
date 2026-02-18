import React, { useState } from 'react'
import {
  FileText, Mail, MessageSquare, HelpCircle, StickyNote,
  CheckCircle, Globe, Mic2, RefreshCw, Loader2
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

interface Props {
  job: Job
  onJobUpdated: () => Promise<void>
  initialTab?: Tab
}

export default function ApplicationWorkspace({ job, onJobUpdated, initialTab }: Props) {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'resume')
  const [markAppliedOpen, setMarkAppliedOpen] = useState(false)
  const [enriching, setEnriching] = useState(false)

  const cfg = STATUS_CONFIG[job.status]

  async function handleEnrich() {
    if (!job.url) { toast('error', 'No URL — add a posting URL to enrich'); return }
    setEnriching(true)
    try {
      const raw = await window.api.jobEnrich([job.id]) as Record<string, unknown>
      if (raw && 'error' in raw) { toast('error', raw.error as string); return }
      const results = raw as Record<number, { success: boolean; error?: string }>
      if (results[job.id]?.success) { toast('success', 'Job enriched'); await onJobUpdated() }
      else toast('error', results[job.id]?.error || 'Enrichment failed')
    } catch (err) { toast('error', String(err)) }
    finally { setEnriching(false) }
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
              <button onClick={() => window.api.openExternal(job.url!)} className="text-xs text-accent hover:underline flex items-center gap-1">
                <Globe size={11} />View posting
              </button>
            )}
          </div>
        </div>

        {/* Status dropdown */}
        <div className="flex items-center gap-2 flex-shrink-0">
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
        <div className="w-80 border-r border-border flex flex-col flex-shrink-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-text-dim uppercase tracking-wider">Job Description</span>
            <button
              onClick={handleEnrich}
              disabled={enriching || !job.url}
              className="btn-ghost p-1 text-text-dim hover:text-text"
              title={job.url ? 'Enrich job' : 'No URL set'}
            >
              {enriching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {job.description ? (
              <p className="text-xs text-text-muted leading-relaxed whitespace-pre-wrap">{job.description}</p>
            ) : (
              <div className="flex flex-col items-center justify-center h-24 text-text-dim">
                <p className="text-xs text-center">No description yet</p>
                <p className="text-[10px] mt-1 opacity-60">Enrich to fetch full details</p>
              </div>
            )}
          </div>
        </div>

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
              <MaterialEditor job={job} type={activeTab} />
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
    </div>
  )
}
