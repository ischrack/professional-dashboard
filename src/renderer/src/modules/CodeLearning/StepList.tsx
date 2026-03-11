import React, { useState } from 'react'
import { CheckCircle, Lock, ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import type { Project, ProjectStep } from '@shared/types'

interface StepListProps {
  project: Project
  steps: ProjectStep[]
  currentStepId: string
  completedCount: number
  onStepClick: (stepId: string) => void
}

export default function StepList({
  project,
  steps,
  currentStepId,
  completedCount,
  onStepClick,
}: StepListProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  const totalSteps = steps.length
  const progressPct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0
  const remainingMinutes = steps
    .filter(s => s.status !== 'completed')
    .reduce((sum, s) => sum + s.estimated_minutes, 0)
  const remainingLabel = remainingMinutes >= 60
    ? `~${Math.round((remainingMinutes / 60) * 10) / 10}h remaining`
    : `~${remainingMinutes}m remaining`

  return (
    <div className="p-4 space-y-4">

      {/* Project details — collapsible */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setDetailsOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-surface-2 transition-colors"
        >
          <span className="text-xs font-semibold text-text-dim uppercase tracking-wider truncate pr-2">
            {project.title}
          </span>
          {detailsOpen
            ? <ChevronDown size={13} className="text-text-dim flex-shrink-0" />
            : <ChevronRight size={13} className="text-text-dim flex-shrink-0" />
          }
        </button>
        {detailsOpen && (
          <div className="px-3 pb-3 pt-1 space-y-1.5">
            <p className="text-xs text-text-muted leading-relaxed">{project.summary}</p>
            <div className="pt-1">
              <p className="text-[10px] font-semibold text-text-dim uppercase tracking-wider mb-0.5">
                Resume artifact
              </p>
              <p className="text-xs text-text-muted">{project.resume_artifact}</p>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {project.languages.map(lang => (
                <span key={lang} className="badge-accent text-[10px]">{lang}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Progress */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-text-muted">
            {completedCount} / {totalSteps} steps complete
          </span>
          <span className="text-xs font-semibold text-accent">{progressPct}%</span>
        </div>
        <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-[11px] text-text-dim mt-1">{remainingLabel}</p>
      </div>

      {/* Step list */}
      <div className="space-y-0.5">
        {steps.map(step => {
          const isActive = step.id === currentStepId
          const isCompleted = step.status === 'completed'
          const isLocked = step.status === 'locked'

          return (
            <button
              key={step.id}
              onClick={() => onStepClick(step.id)}
              disabled={isLocked}
              className={clsx(
                'w-full flex items-start gap-2.5 px-3 py-2.5 rounded-md text-left transition-colors',
                isActive && 'bg-accent/10 border border-accent/20',
                !isActive && isCompleted && 'hover:bg-surface-2 cursor-pointer',
                !isActive && !isLocked && !isCompleted && 'hover:bg-surface-2',
                isLocked && 'opacity-40 cursor-not-allowed',
              )}
            >
              {/* Status icon */}
              <div className="flex-shrink-0 mt-0.5">
                {isCompleted && <CheckCircle size={14} className="text-success" />}
                {isActive && (
                  <div className="w-3.5 h-3.5 rounded-full bg-accent mt-0.5" />
                )}
                {isLocked && <Lock size={14} className="text-text-dim" />}
              </div>

              {/* Step text */}
              <div className="flex-1 min-w-0">
                <p className={clsx(
                  'text-xs leading-snug',
                  isActive ? 'font-semibold text-text'
                    : isCompleted ? 'text-text-muted'
                    : 'text-text-dim',
                )}>
                  {step.step_number}. {step.title}
                </p>
                {(isActive || isCompleted) && (
                  <p className="text-[10px] text-text-dim mt-0.5">
                    {step.estimated_minutes}m
                    {isCompleted && ' · done'}
                  </p>
                )}
              </div>
            </button>
          )
        })}
      </div>

    </div>
  )
}
