import React from 'react'
import { Check, Loader2 } from 'lucide-react'

interface GeneratedStepPreview {
  step_number: number
  title: string
}

interface CurriculumGeneratingProps {
  projectTitle: string
  completedSteps: GeneratedStepPreview[]
  estimatedTotal: number
}

export default function CurriculumGenerating({
  projectTitle,
  completedSteps,
  estimatedTotal,
}: CurriculumGeneratingProps) {
  const currentStepNumber = completedSteps.length + 1
  const isComplete = completedSteps.length >= estimatedTotal
  // Placeholder rows = steps not yet reached (excluding the current in-progress step)
  const placeholderCount = Math.max(0, estimatedTotal - completedSteps.length - 1)

  return (
    <div className="flex flex-col">

      {/* Project title + status */}
      <div className="mb-6">
        <h3 className="text-base font-semibold text-text mb-0.5">{projectTitle}</h3>
        <p className="text-sm text-text-dim">
          {isComplete
            ? `Curriculum complete — ${completedSteps.length} steps generated`
            : `Building your curriculum\u2026`}
        </p>
      </div>

      {/* Step list */}
      <div className="space-y-1.5">

        {/* Completed steps */}
        {completedSteps.map(step => (
          <div
            key={step.step_number}
            className="flex items-center gap-3 px-3 py-2 rounded-md bg-surface-2"
          >
            <Check size={14} className="text-success flex-shrink-0" />
            <span className="text-sm text-text-muted">
              Step {step.step_number}: {step.title}
            </span>
          </div>
        ))}

        {/* Current in-progress step */}
        {!isComplete && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-surface-2 border border-accent/20">
            <Loader2 size={14} className="text-accent animate-spin flex-shrink-0" />
            <span className="text-sm text-text">
              Generating step {currentStepNumber}
              {estimatedTotal > 0 ? ` of ${estimatedTotal}` : ''}\u2026
            </span>
          </div>
        )}

        {/* Placeholder rows for steps not yet reached */}
        {Array.from({ length: placeholderCount }).map((_, i) => (
          <div
            key={`ph-${i}`}
            className="flex items-center gap-3 px-3 py-2 rounded-md bg-surface opacity-40"
          >
            <div className="w-3.5 h-3.5 rounded-full border border-border flex-shrink-0" />
            <div className="h-2 bg-surface-3 rounded w-48" />
          </div>
        ))}

      </div>
    </div>
  )
}
