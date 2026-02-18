import React, { useState, useEffect } from 'react'
import {
  Plus, RefreshCw, Loader2, Briefcase,
  Mail, AlertCircle
} from 'lucide-react'
import clsx from 'clsx'
import { useToast } from '../../shared/hooks/useToast'
import type { Job } from '@shared/types'
import JobCard from './JobCard'
import ApplicationWorkspace from './ApplicationWorkspace'
import QuickAddModal from './QuickAddModal'

export default function JobSearch() {
  const { toast } = useToast()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [enriching, setEnriching] = useState(false)
  const [enrichProgress, setEnrichProgress] = useState('')
  const [imapPolling, setImapPolling] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    loadJobs()
  }, [])

  async function loadJobs() {
    setLoading(true)
    const js = await window.api.jobGetAll() as Job[]
    setJobs(js)
    setLoading(false)
  }

  async function handlePollImap() {
    setImapPolling(true)
    try {
      const result = await window.api.jobImapPoll() as { added?: number; error?: string }
      if (result.error) toast('error', result.error)
      else toast('success', `IMAP poll: ${result.added ?? 0} new jobs added`)
      await loadJobs()
    } catch (err) {
      toast('error', String(err))
    } finally {
      setImapPolling(false)
    }
  }

  async function handleEnrich() {
    const ids = Array.from(checkedIds)
    if (ids.length === 0) return
    if (ids.length > 10) {
      toast('error', 'Maximum 10 jobs per enrichment batch')
      return
    }
    setEnriching(true)
    setEnrichProgress(`Enriching ${ids.length} jobs...`)
    try {
      const results = await window.api.jobEnrich(ids) as Record<number, { success: boolean; error?: string }>
      const succeeded = Object.values(results).filter(r => r.success).length
      const failed = ids.length - succeeded
      toast(failed > 0 ? 'info' : 'success', `Enriched ${succeeded}/${ids.length} jobs${failed > 0 ? ` (${failed} failed)` : ''}`)
      setCheckedIds(new Set())
      await loadJobs()
    } catch (err) {
      toast('error', String(err))
    } finally {
      setEnriching(false)
      setEnrichProgress('')
    }
  }

  function toggleCheck(id: number) {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 10) next.add(id)
      else toast('error', 'Maximum 10 jobs per enrichment batch')
      return next
    })
  }

  async function handleAddJob(job: Partial<Job>) {
    const id = await window.api.jobAdd(job as Record<string, unknown>) as number
    setQuickAddOpen(false)
    await loadJobs()
    const newJob = await window.api.jobGetById(id) as Job
    setSelectedJob(newJob)
    toast('success', 'Job added')
  }

  async function handleJobUpdated() {
    await loadJobs()
    if (selectedJob) {
      const updated = await window.api.jobGetById(selectedJob.id) as Job
      setSelectedJob(updated)
    }
  }

  const filtered = jobs.filter(j => {
    if (filter === 'all') return true
    if (filter === 'needs_enrichment') return j.status === 'needs_enrichment' || j.status === 'enrichment_failed'
    if (filter === 'applied') return j.appliedAt
    return j.status === filter
  })

  const needsEnrichmentCount = jobs.filter(j => j.status === 'needs_enrichment').length

  return (
    <div className="flex h-full overflow-hidden">
      {/* Job list panel */}
      <div className="w-80 flex flex-col border-r border-border flex-shrink-0">
        {/* Header */}
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">Jobs ({jobs.length})</h2>
            <div className="flex gap-1">
              <button onClick={handlePollImap} disabled={imapPolling} className="btn-ghost p-1.5" title="Poll IMAP">
                {imapPolling ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
              </button>
              <button onClick={() => setQuickAddOpen(true)} className="btn-ghost p-1.5" title="Quick Add">
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Enrich button */}
          {checkedIds.size > 0 && (
            <div className="space-y-1.5">
              <button
                onClick={handleEnrich}
                disabled={enriching || checkedIds.size > 10}
                className="btn-primary w-full text-xs justify-center"
                title={checkedIds.size > 10 ? 'Maximum 10 jobs per batch' : ''}
              >
                {enriching ? (
                  <><Loader2 size={12} className="animate-spin" />{enrichProgress}</>
                ) : (
                  <><RefreshCw size={12} />Enrich Selected ({checkedIds.size})</>
                )}
              </button>
              {checkedIds.size >= 10 && (
                <p className="text-xs text-warning text-center flex items-center justify-center gap-1">
                  <AlertCircle size={11} />10 job limit per batch
                </p>
              )}
            </div>
          )}

          {/* Status filter */}
          <div className="flex flex-wrap gap-1 mt-2">
            {[
              { id: 'all', label: 'All' },
              { id: 'needs_enrichment', label: `Needs data (${needsEnrichmentCount})` },
              { id: 'no_response', label: 'Active' },
              { id: 'applied', label: 'Applied' },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={clsx('badge text-xs cursor-pointer', filter === f.id ? 'badge-accent' : 'badge-gray')}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Job list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-20">
              <Loader2 size={16} className="animate-spin text-accent" />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-text-dim p-4">
              <Briefcase size={24} className="mb-2 opacity-30" />
              <p className="text-xs text-center">No jobs yet. Add via Quick Add or configure IMAP to poll LinkedIn alerts.</p>
            </div>
          )}
          {filtered.map(job => (
            <JobCard
              key={job.id}
              job={job}
              selected={selectedJob?.id === job.id}
              checked={checkedIds.has(job.id)}
              onSelect={() => setSelectedJob(job)}
              onToggleCheck={() => toggleCheck(job.id)}
            />
          ))}
        </div>
      </div>

      {/* Workspace */}
      <div className="flex-1 overflow-hidden">
        {selectedJob ? (
          <ApplicationWorkspace
            job={selectedJob}
            onJobUpdated={handleJobUpdated}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-dim">
            <Briefcase size={48} className="mb-4 opacity-20" />
            <p className="text-sm">Select a job to open the workspace</p>
            <p className="text-xs mt-1 opacity-60">Or click <Plus size={11} className="inline" /> to add a job</p>
          </div>
        )}
      </div>

      {quickAddOpen && (
        <QuickAddModal
          onClose={() => setQuickAddOpen(false)}
          onAdd={handleAddJob}
        />
      )}
    </div>
  )
}
