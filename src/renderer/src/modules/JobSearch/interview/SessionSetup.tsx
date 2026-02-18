import React, { useState } from 'react'
import { Play, AlertCircle } from 'lucide-react'
import clsx from 'clsx'
import type { InterviewCategory, InterviewMode, InterviewSession } from '@shared/types'

const CATEGORIES: { id: InterviewCategory; label: string; description: string; estimatedCount: number }[] = [
  { id: 'behavioral', label: 'Behavioral (STAR)', description: 'Situational questions requiring structured examples', estimatedCount: 4 },
  { id: 'technical', label: 'Technical / Domain', description: 'Questions specific to your field and skills', estimatedCount: 3 },
  { id: 'culture_fit', label: 'Culture Fit', description: 'Values alignment and working-style questions', estimatedCount: 2 },
  { id: 'role_specific', label: 'Role-Specific', description: 'Why this company, why this role, goals', estimatedCount: 2 },
  { id: 'curveball', label: 'Curveball / Stress', description: 'Unexpected or challenging questions', estimatedCount: 2 },
  { id: 'questions_to_ask', label: 'Questions to Ask', description: 'Practice asking questions as the candidate', estimatedCount: 3 },
]

interface SessionSetupProps {
  hasBrief: boolean
  onBegin: (mode: InterviewMode, categories: InterviewCategory[]) => void
}

export default function SessionSetup({ hasBrief, onBegin }: SessionSetupProps) {
  const [mode, setMode] = useState<InterviewMode>('live_feedback')
  const [selected, setSelected] = useState<Set<InterviewCategory>>(new Set(CATEGORIES.map(c => c.id)))

  const estimatedCount = CATEGORIES
    .filter(c => selected.has(c.id))
    .reduce((sum, c) => sum + c.estimatedCount, 0)

  function toggleCategory(id: InterviewCategory) {
    setSelected(prev => {
      const next = new Set(prev)
      if (id === 'questions_to_ask') return next // always included, not toggleable
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="p-4 space-y-5">
      {/* Mode selector */}
      <div>
        <label className="block text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">Interview Mode</label>
        <div className="grid grid-cols-2 gap-3">
          {([
            {
              id: 'live_feedback' as const,
              label: 'Live Feedback',
              description: 'Get structured feedback after each answer before the next question.',
            },
            {
              id: 'full_run' as const,
              label: 'Full Run',
              description: 'Answer all questions without interruption, then receive a complete debrief.',
            },
          ]).map(opt => (
            <button
              key={opt.id}
              onClick={() => setMode(opt.id)}
              className={clsx(
                'p-3 rounded-lg border-2 text-left transition-colors',
                mode === opt.id ? 'border-accent bg-accent/10' : 'border-border hover:border-border/60 hover:bg-surface-2'
              )}
            >
              <div className="font-semibold text-sm text-text mb-0.5">{opt.label}</div>
              <p className="text-xs text-text-dim leading-relaxed">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Category toggles */}
      <div>
        <label className="block text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">Question Categories</label>
        <div className="space-y-1.5">
          {CATEGORIES.map(cat => {
            const isAlwaysOn = cat.id === 'questions_to_ask'
            const isOn = selected.has(cat.id)
            return (
              <label
                key={cat.id}
                className={clsx(
                  'flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors',
                  isOn ? 'bg-surface-2' : 'hover:bg-surface-2/50',
                  isAlwaysOn && 'opacity-60 cursor-not-allowed'
                )}
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  disabled={isAlwaysOn}
                  onChange={() => toggleCategory(cat.id)}
                  className="accent-accent mt-0.5 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text">{cat.label}</span>
                    {isAlwaysOn && <span className="text-[10px] text-text-dim">(always included)</span>}
                  </div>
                  <p className="text-xs text-text-dim">{cat.description}</p>
                </div>
              </label>
            )
          })}
        </div>
      </div>

      {/* Estimated count + warnings */}
      <div className="flex items-center justify-between pt-1">
        <div className="text-xs text-text-dim">
          Estimated: <span className="font-medium text-text">~{estimatedCount} questions</span>
        </div>
        {!hasBrief && (
          <div className="flex items-center gap-1 text-xs text-warning">
            <AlertCircle size={12} />
            <span>No research brief yet — session will proceed without company context</span>
          </div>
        )}
      </div>

      <button
        onClick={() => onBegin(mode, Array.from(selected))}
        disabled={selected.size === 0}
        className="btn-primary w-full justify-center"
      >
        <Play size={14} />
        Begin Session
      </button>
    </div>
  )
}

export { CATEGORIES }
