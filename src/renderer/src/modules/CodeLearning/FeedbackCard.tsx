import React, { useState } from 'react'
import { CheckCircle, AlertTriangle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import clsx from 'clsx'
import type { FeedbackResponse, FeedbackIssue } from '@shared/types'

// ── Issue row sub-component ─────────────────────────────────────────────────

const ISSUE_CONFIG = {
  blocking: {
    border: 'border-l-2 border-error',
    label: 'Blocking',
    labelColor: 'text-error',
  },
  minor: {
    border: 'border-l-2 border-warning',
    label: 'Minor',
    labelColor: 'text-warning',
  },
  style: {
    border: 'border-l-2 border-border',
    label: 'Style',
    labelColor: 'text-text-dim',
  },
} as const

function IssueRow({ issue }: { issue: FeedbackIssue }) {
  const cfg = ISSUE_CONFIG[issue.severity]
  return (
    <div className={clsx('pl-3 py-2.5 pr-3 rounded-r-md bg-surface-2', cfg.border)}>
      <p className={clsx('text-[10px] font-semibold uppercase tracking-wider mb-1', cfg.labelColor)}>
        {cfg.label}
      </p>
      <p className="text-sm text-text-muted leading-relaxed mb-1.5">{issue.description}</p>
      <p className="text-xs text-text-dim leading-relaxed italic">{issue.hint}</p>
    </div>
  )
}

// ── FeedbackCard ────────────────────────────────────────────────────────────

interface FeedbackCardProps {
  response: FeedbackResponse
  onRequestReview: () => void
}

export default function FeedbackCard({ response, onRequestReview }: FeedbackCardProps) {
  const [styleNotesOpen, setStyleNotesOpen] = useState(false)

  const isPositive = response.overall === 'on_track' || response.overall === 'complete'

  const blockingIssues = response.issues.filter(i => i.severity === 'blocking')
  const minorIssues = response.issues.filter(i => i.severity === 'minor')
  const styleIssues = response.issues.filter(i => i.severity === 'style')

  const overallLabel = {
    complete: 'Complete',
    on_track: 'On track',
    needs_work: 'Needs work',
  }[response.overall]

  return (
    <div className="rounded-lg border border-border overflow-hidden w-full">

      {/* Colored header bar */}
      <div className={clsx(
        'px-4 py-2.5 flex items-center gap-2 border-b',
        isPositive
          ? 'bg-success/10 border-success/20'
          : 'bg-warning/10 border-warning/20',
      )}>
        {isPositive
          ? <CheckCircle size={14} className="text-success flex-shrink-0" />
          : <AlertTriangle size={14} className="text-warning flex-shrink-0" />
        }
        <span className={clsx(
          'text-xs font-semibold uppercase tracking-wider',
          isPositive ? 'text-success' : 'text-warning',
        )}>
          Code review · {overallLabel}
        </span>
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* Summary */}
        <p className="text-sm text-text-muted leading-relaxed">{response.summary}</p>

        {/* What's working */}
        {response.strengths.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-success uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <CheckCircle size={11} />
              What's working
            </p>
            <ul className="space-y-1.5">
              {response.strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-text-muted">
                  <span className="text-success mt-1 flex-shrink-0 leading-none">·</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Blocking issues */}
        {blockingIssues.length > 0 && (
          <div className="space-y-2">
            {blockingIssues.map((issue, i) => (
              <IssueRow key={i} issue={issue} />
            ))}
          </div>
        )}

        {/* Minor issues */}
        {minorIssues.length > 0 && (
          <div className="space-y-2">
            {minorIssues.map((issue, i) => (
              <IssueRow key={i} issue={issue} />
            ))}
          </div>
        )}

        {/* Style notes — collapsible toggle */}
        {styleIssues.length > 0 && (
          <div>
            <button
              onClick={() => setStyleNotesOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs text-text-dim hover:text-text transition-colors"
            >
              {styleNotesOpen
                ? <ChevronDown size={12} />
                : <ChevronRight size={12} />
              }
              Style notes ({styleIssues.length})
            </button>
            {styleNotesOpen && (
              <div className="mt-2 space-y-2">
                {styleIssues.map((issue, i) => (
                  <IssueRow key={i} issue={issue} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Next nudge */}
        {response.next_nudge && (
          <div className="p-3 bg-surface-2 rounded-md border border-border">
            <p className="text-[10px] font-semibold text-text-dim uppercase tracking-wider mb-1">
              Next step
            </p>
            <p className="text-sm text-text-muted leading-relaxed">{response.next_nudge}</p>
          </div>
        )}

        {/* Request another review */}
        <button
          onClick={onRequestReview}
          className="btn-ghost text-xs w-full justify-center"
        >
          <RefreshCw size={12} />
          Request Another Review
        </button>

      </div>
    </div>
  )
}
