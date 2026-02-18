import React from 'react'
import { MapPin, Calendar } from 'lucide-react'
import clsx from 'clsx'
import type { Job } from '@shared/types'
import { STATUS_CONFIG } from '../../shared/utils/statusConfig'

interface Props {
  job: Job
  selected: boolean
  checked: boolean
  onSelect: () => void
  onToggleCheck: () => void
}

export default function JobCard({ job, selected, checked, onSelect, onToggleCheck }: Props) {
  const cfg = STATUS_CONFIG[job.status]

  // Company logo via Clearbit domain inference
  const domain = `${job.company.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30)}.com`
  const logoUrl = job.logoUrl || `https://logo.clearbit.com/${domain}`

  return (
    <div
      className={clsx(
        'flex items-start gap-2 px-3 py-2.5 border-b border-border/50 cursor-pointer transition-colors group',
        selected ? 'bg-accent/10' : 'hover:bg-surface-2'
      )}
      onClick={onSelect}
    >
      {/* Checkbox */}
      <button
        onClick={e => { e.stopPropagation(); onToggleCheck() }}
        className={clsx(
          'flex-shrink-0 mt-0.5 transition-colors',
          checked ? 'text-accent' : 'text-transparent group-hover:text-text-dim hover:text-accent'
        )}
      >
        {checked
          ? <span className="inline-block w-3.5 h-3.5 rounded-sm bg-accent" />
          : <span className="inline-block w-3.5 h-3.5 rounded-sm border border-border" />
        }
      </button>

      {/* Logo */}
      <img
        src={logoUrl}
        alt={job.company}
        className="w-7 h-7 rounded flex-shrink-0 object-contain bg-surface-2 border border-border"
        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-semibold text-text truncate">{job.company}</span>
          <span className={clsx('badge text-[10px] flex-shrink-0', cfg.badgeClass)}>
            {cfg.label}
          </span>
        </div>
        <p className="text-xs text-text-muted truncate mt-0.5">{job.title}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {job.location && (
            <span className="flex items-center gap-0.5 text-[10px] text-text-dim">
              <MapPin size={9} />{job.location}
            </span>
          )}
          <span className="flex items-center gap-0.5 text-[10px] text-text-dim">
            <Calendar size={9} />
            {new Date(job.addedAt).toLocaleDateString()}
          </span>
          {job.remote && (
            <span className="badge badge-gray text-[10px]">{job.remote}</span>
          )}
        </div>
      </div>
    </div>
  )
}
