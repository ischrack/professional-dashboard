import React, { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { Job } from '@shared/types'

interface Props {
  job: Job
  onClose: () => void
  onApplied: () => Promise<void>
}

export default function MarkAppliedModal({ job, onClose, onApplied }: Props) {
  const [appliedAt, setAppliedAt] = useState(new Date().toISOString().split('T')[0])
  const [salaryRange, setSalaryRange] = useState('')
  const [remote, setRemote] = useState('')
  const [applicationSource, setApplicationSource] = useState('LinkedIn')
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    setSaving(true)
    await window.api.jobMarkApplied(job.id, {
      appliedAt,
      salaryRange: salaryRange || undefined,
      remote: remote || undefined,
      applicationSource,
    })
    await onApplied()
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="card w-96 p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Mark as Applied</h3>
          <button onClick={onClose} className="btn-ghost p-1"><X size={14} /></button>
        </div>

        <p className="text-xs text-text-muted">
          Logging application for <strong>{job.title}</strong> at <strong>{job.company}</strong>
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Application Date <span className="text-error">*</span></label>
            <input type="date" value={appliedAt} onChange={e => setAppliedAt(e.target.value)} className="input" />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Salary Range <span className="text-text-dim">(optional)</span></label>
            <input value={salaryRange} onChange={e => setSalaryRange(e.target.value)} className="input" placeholder="e.g., $120k–$150k" />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Work Mode <span className="text-text-dim">(optional)</span></label>
            <select value={remote} onChange={e => setRemote(e.target.value)} className="input">
              <option value="">Not specified</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Application Source <span className="text-text-dim">(optional)</span></label>
            <select value={applicationSource} onChange={e => setApplicationSource(e.target.value)} className="input">
              <option>LinkedIn</option>
              <option>Company Site</option>
              <option>Referral</option>
              <option>Job Board</option>
              <option>Other</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={handleSubmit} disabled={!appliedAt || saving} className="btn-primary flex-1 justify-center">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Log Application
          </button>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  )
}
