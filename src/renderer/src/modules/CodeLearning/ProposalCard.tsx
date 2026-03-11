import React from 'react'
import { CheckCircle, Clock, Layers, RotateCcw, Play, Edit2 } from 'lucide-react'
import type { ProjectProposal } from '@shared/types'

interface ProposalCardProps {
  proposal: ProjectProposal
  onStart: () => void
  onTryAnother: () => void
  onEditDetails: () => void
}

export default function ProposalCard({ proposal, onStart, onTryAnother, onEditDetails }: ProposalCardProps) {
  return (
    <div className="space-y-5">

      {/* Title + meta */}
      <div>
        <h2 className="text-xl font-semibold text-text leading-tight">{proposal.title}</h2>
        <div className="flex flex-wrap items-center gap-2 mt-2.5">
          {proposal.languages.map(lang => (
            <span key={lang} className="badge-accent">{lang}</span>
          ))}
          <span className="flex items-center gap-1 text-xs text-text-dim">
            <Layers size={12} />
            {proposal.estimated_steps} steps
          </span>
          <span className="flex items-center gap-1 text-xs text-text-dim">
            <Clock size={12} />
            ~{proposal.estimated_hours}h
          </span>
        </div>
      </div>

      {/* Summary */}
      <p className="text-sm text-text-muted leading-relaxed">{proposal.summary}</p>

      {/* What you'll learn */}
      <div>
        <p className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">
          What you'll learn
        </p>
        <ul className="space-y-1.5">
          {proposal.what_you_will_learn.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-text">
              <CheckCircle size={14} className="text-success flex-shrink-0 mt-0.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Prerequisites */}
      {proposal.prerequisite_installs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">
            Prerequisites
          </p>
          <div className="flex flex-wrap gap-2">
            {proposal.prerequisite_installs.map((req, i) => (
              <span key={i} className="badge-gray">{req}</span>
            ))}
          </div>
        </div>
      )}

      {/* Resume artifact */}
      <div className="p-3 rounded-lg bg-surface-2 border border-border">
        <p className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-1">
          Resume artifact
        </p>
        <p className="text-sm text-text">{proposal.resume_artifact}</p>
      </div>

      {/* Why this project */}
      <div>
        <p className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-1">
          Why this project
        </p>
        <p className="text-sm text-text-muted leading-relaxed">{proposal.why_this_project}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        <button onClick={onStart} className="btn-primary flex-1 justify-center">
          <Play size={14} />
          Start This Project
        </button>
        <button onClick={onTryAnother} className="btn-secondary">
          <RotateCcw size={14} />
          Try a Different Idea
        </button>
        <button onClick={onEditDetails} className="btn-ghost">
          <Edit2 size={14} />
          Edit Details
        </button>
      </div>

    </div>
  )
}
