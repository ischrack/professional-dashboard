import React, { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { Job } from '@shared/types'

interface Props {
  onClose: () => void
  onAdd: (job: Partial<Job>) => Promise<void>
}

export default function QuickAddModal({ onClose, onAdd }: Props) {
  const [company, setCompany] = useState('')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [appliedAt, setAppliedAt] = useState(new Date().toISOString().split('T')[0])
  const [fetchNow, setFetchNow] = useState(true)
  const [saving, setSaving] = useState(false)
  const [urlPreviewing, setUrlPreviewing] = useState(false)

  async function handleUrlBlur() {
    if (!url.trim() || company || title) return
    setUrlPreviewing(true)
    try {
      const r = await window.api.jobPreviewUrl(url) as { jobTitle?: string; company?: string }
      if (r.jobTitle && !title) setTitle(r.jobTitle)
      if (r.company && !company) setCompany(r.company)
    } catch { /* ignore */ }
    finally { setUrlPreviewing(false) }
  }

  async function handleSubmit() {
    if (!company || !title) return
    setSaving(true)
    await onAdd({
      company,
      title,
      url: url || undefined,
      appliedAt: appliedAt || undefined,
      status: url ? (fetchNow ? 'needs_enrichment' : 'no_response') : 'no_response',
      source: 'manual',
    })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="card w-96 p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Quick Add Job</h3>
          <button onClick={onClose} className="btn-ghost p-1"><X size={14} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Company <span className="text-error">*</span></label>
            <input value={company} onChange={e => setCompany(e.target.value)} className="input" placeholder="Genentech" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Job Title <span className="text-error">*</span></label>
            <input value={title} onChange={e => setTitle(e.target.value)} className="input" placeholder="Senior Scientist, Immunology" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1 flex items-center gap-1">
              Job Posting URL
              {urlPreviewing && <Loader2 size={11} className="animate-spin text-text-dim" />}
            </label>
            <input value={url} onChange={e => setUrl(e.target.value)} onBlur={handleUrlBlur} className="input" placeholder="https://linkedin.com/jobs/view/..." type="url" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Application Date</label>
            <input value={appliedAt} onChange={e => setAppliedAt(e.target.value)} type="date" className="input" />
          </div>
          {url && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={fetchNow} onChange={e => setFetchNow(e.target.checked)} className="accent-accent" />
              <span className="text-xs text-text-muted">Fetch job description now</span>
            </label>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={handleSubmit} disabled={!company || !title || saving} className="btn-primary flex-1 justify-center">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Add Job
          </button>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  )
}
