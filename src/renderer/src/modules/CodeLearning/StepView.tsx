import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  CheckCircle, Clock, FileCode, ChevronDown, ChevronRight,
  Lightbulb, MessageSquare, CheckSquare,
} from 'lucide-react'
import clsx from 'clsx'
import type { ProjectStep } from '@shared/types'

// Shared markdown component map — matches CollapsibleMarkdown styling
const md = {
  p: ({ children }: { children: React.ReactNode }) => (
    <p className="text-sm text-text-muted leading-relaxed mb-2 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children: React.ReactNode }) => (
    <ul className="list-disc list-outside ml-4 space-y-1 mb-2">{children}</ul>
  ),
  ol: ({ children }: { children: React.ReactNode }) => (
    <ol className="list-decimal list-outside ml-4 space-y-1 mb-2">{children}</ol>
  ),
  li: ({ children }: { children: React.ReactNode }) => (
    <li className="text-sm text-text-muted leading-relaxed">{children}</li>
  ),
  strong: ({ children }: { children: React.ReactNode }) => (
    <strong className="font-semibold text-text">{children}</strong>
  ),
  em: ({ children }: { children: React.ReactNode }) => <em className="italic">{children}</em>,
  code: ({ children }: { children: React.ReactNode }) => (
    <code className="bg-surface-3 px-1 py-0.5 rounded text-xs font-mono text-text">{children}</code>
  ),
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2 className="text-sm font-semibold text-text mt-4 mb-1.5 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mt-3 mb-1">{children}</h3>
  ),
  blockquote: ({ children }: { children: React.ReactNode }) => (
    <blockquote className="border-l-2 border-accent/40 pl-3 italic text-text-dim my-2">{children}</blockquote>
  ),
}

interface StepViewProps {
  step: ProjectStep
  stepTotal: number
  hintsRevealed: number
  contextInitiallyOpen: boolean
  onRevealHint: () => void
  onMarkComplete: () => void
  onScrollToChat: () => void
  onContextViewed: () => void
}

export default function StepView({
  step,
  stepTotal,
  hintsRevealed,
  contextInitiallyOpen,
  onRevealHint,
  onMarkComplete,
  onScrollToChat,
  onContextViewed,
}: StepViewProps) {
  const [contextOpen, setContextOpen] = useState(contextInitiallyOpen)

  function toggleContext() {
    const next = !contextOpen
    setContextOpen(next)
    if (next) onContextViewed()
  }

  const isComplete = step.status === 'completed'
  const allHintsRevealed = hintsRevealed >= step.hints.length
  const timeLabel = step.estimated_minutes >= 60
    ? `~${Math.round((step.estimated_minutes / 60) * 10) / 10}h`
    : `~${step.estimated_minutes}m`

  return (
    <div className="space-y-5">

      {/* ── 1. Step Header ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-dim">
              Step {step.step_number} of {stepTotal}
            </span>
            {isComplete && (
              <span className="badge-green flex items-center gap-1">
                <CheckCircle size={10} />
                Complete
              </span>
            )}
            {step.status === 'active' && (
              <span className="badge-accent">In progress</span>
            )}
          </div>
          <span className="flex items-center gap-1 text-xs text-text-dim flex-shrink-0">
            <Clock size={12} />
            {timeLabel}
          </span>
        </div>

        <h2 className="text-base font-semibold text-text leading-snug">{step.title}</h2>
        <p className="text-sm text-text-muted mt-1 leading-relaxed">{step.objective}</p>

        {step.target_file && (
          <button
            className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-2 border border-border text-xs text-text-muted hover:text-accent hover:border-accent/30 transition-colors font-mono"
            title="Click to open in VS Code (coming soon)"
            onClick={() => console.log('[stub] open file', step.target_file)}
          >
            <FileCode size={11} />
            {step.target_file}
            {step.target_function_or_block && (
              <span className="text-text-dim ml-1">· {step.target_function_or_block}</span>
            )}
          </button>
        )}
      </div>

      {/* ── 2. Context (collapsible) ────────────────────────────────────── */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={toggleContext}
          className={clsx(
            'w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors',
            contextOpen ? 'bg-surface-2' : 'hover:bg-surface-2',
          )}
        >
          <span className="text-xs font-semibold text-text-dim uppercase tracking-wider">
            Context
          </span>
          {contextOpen
            ? <ChevronDown size={14} className="text-text-dim" />
            : <ChevronRight size={14} className="text-text-dim" />
          }
        </button>
        {contextOpen && (
          <div className="px-4 pt-3 pb-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>
              {step.context}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* ── 3. Instructions (always visible) ────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">
          Instructions
        </p>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>
          {step.instructions}
        </ReactMarkdown>
      </div>

      {/* ── 4. Hints panel ──────────────────────────────────────────────── */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3">
          {hintsRevealed === 0 ? (
            <button
              onClick={onRevealHint}
              className="btn-ghost text-sm w-full justify-start gap-2"
            >
              <Lightbulb size={14} className="text-warning" />
              Need a hint?
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text-dim uppercase tracking-wider flex items-center gap-1.5">
                  <Lightbulb size={12} className="text-warning" />
                  Hints
                </span>
                <span className="text-xs text-text-dim">
                  {hintsRevealed} of {step.hints.length} revealed
                </span>
              </div>

              {step.hints.slice(0, hintsRevealed).map((hint, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2.5 p-3 bg-warning/5 border border-warning/20 rounded-md"
                >
                  <span className="text-[10px] font-semibold text-warning mt-0.5 flex-shrink-0 w-4">
                    {i + 1}
                  </span>
                  <p className="text-sm text-text-muted leading-relaxed">{hint}</p>
                </div>
              ))}

              {!allHintsRevealed && (
                <button
                  onClick={onRevealHint}
                  className="btn-ghost text-xs w-full justify-start gap-1.5"
                >
                  <Lightbulb size={12} className="text-warning" />
                  Show hint {hintsRevealed + 1} of {step.hints.length}
                </button>
              )}

              {allHintsRevealed && (
                <div className="flex items-center gap-2 pt-1">
                  <p className="text-sm text-text-dim">Still stuck?</p>
                  <button
                    onClick={onScrollToChat}
                    className="text-sm text-accent hover:underline flex items-center gap-1.5 transition-colors"
                  >
                    <MessageSquare size={12} />
                    Ask the coach
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 5. Mark complete / done indicator ───────────────────────────── */}
      {isComplete ? (
        <div className="flex items-center justify-center gap-2 py-4 text-success text-sm">
          <CheckCircle size={16} />
          <span>Step completed</span>
        </div>
      ) : (
        <div className="pb-6">
          <button
            onClick={onMarkComplete}
            className="btn-secondary w-full justify-center"
          >
            <CheckSquare size={14} />
            Mark This Step Complete
          </button>
        </div>
      )}

    </div>
  )
}
