import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { ResumeCompareWindowPayload } from '@shared/types'
import ResumeCompareContent from './ResumeCompareContent'

const EMPTY_PAYLOAD: ResumeCompareWindowPayload = {
  jobId: 0,
  company: '',
  jobTitle: '',
  baseResumeName: '',
  hasBaseContent: false,
  hasCompareRows: false,
  rows: [],
  stats: { api: 0, manual: 0, removed: 0, unchanged: 0 },
}

export default function ResumeCompareWindow() {
  const [payload, setPayload] = useState<ResumeCompareWindowPayload>(EMPTY_PAYLOAD)
  const [showChanges, setShowChanges] = useState(true)

  useEffect(() => {
    const unsub = window.api.onResumeCompareData((next: ResumeCompareWindowPayload) => {
      setPayload(next || EMPTY_PAYLOAD)
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  return (
    <div className="h-screen w-screen bg-bg text-text flex flex-col overflow-hidden">
      <div className="titlebar-drag border-b border-border pl-20 pr-2 py-2 flex items-start gap-2 min-h-16">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wider text-text-dim font-semibold">Base Resume Compare</p>
          <p className="text-xs text-text-muted truncate">
            {payload.baseResumeName || 'No base selected'}
            {payload.company && payload.jobTitle ? ` • ${payload.company} — ${payload.jobTitle}` : ''}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="px-1.5 py-0.5 rounded bg-success/15 text-success">{payload.stats.api} API edits</span>
            <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent">{payload.stats.manual} Manual edits</span>
            <span className="px-1.5 py-0.5 rounded bg-error/15 text-error">{payload.stats.removed} Removed</span>
            <span className="px-1.5 py-0.5 rounded bg-surface-2 text-text-dim">{payload.stats.unchanged} Unchanged</span>
            <button
              type="button"
              className="titlebar-no-drag btn-ghost text-[10px] py-0.5 px-1.5"
              onClick={() => setShowChanges(prev => !prev)}
            >
              {showChanges ? 'Hide Changes' : 'Show Changes'}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="titlebar-no-drag btn-ghost p-1 mt-0.5 shrink-0"
          title="Close compare window"
          onClick={() => { void window.api.resumeCompareClose() }}
        >
          <X size={14} />
        </button>
      </div>

      <ResumeCompareContent payload={payload} showChanges={showChanges} />
    </div>
  )
}
