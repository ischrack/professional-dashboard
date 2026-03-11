import React, { useState, useEffect } from 'react'
import { HelpCircle } from 'lucide-react'
import IntakeForm from './IntakeForm'
import ProposalCard from './ProposalCard'
import CurriculumGenerating from './CurriculumGenerating'
import ActiveProject from './ActiveProject'
import CodeLearningHelp from './CodeLearningHelp'
import type { CodeLearningIntakeForm, ProjectProposal, Project } from '@shared/types'
import { inferProvider } from '../../shared/utils/llm'

// ── Settings helpers ──────────────────────────────────────────────────────────

interface ModelInfo {
  model: string
  provider: 'anthropic' | 'openai'
}

type ModelInfoResult = ModelInfo | { error: string }

async function resolveModelInfo(): Promise<ModelInfoResult> {
  const settings = await window.api.getSettings() as Record<string, unknown>
  const models = settings.models as Record<string, string> | undefined
  const model = models?.codeLearning || 'claude-opus-4-6'
  const provider = inferProvider(model)
  console.log('[CodeLearning resolveModelInfo] model:', model, '| provider:', provider)
  console.warn('[CodeLearning resolveModelInfo] codeLearning model value:', models?.codeLearning, '| full models:', models)
  const apiKey = await window.api.getApiKey(provider === 'openai' ? 'openaiKey' : 'anthropicKey') as string
  if (!apiKey) {
    const providerLabel = provider === 'openai' ? 'OpenAI' : 'Anthropic'
    console.warn('[CodeLearning resolveModelInfo] no key for provider:', providerLabel, '| full models object:', models)
    return { error: `No ${providerLabel} API key found for model "${model}". Add your key in Settings → API Keys.` }
  }
  return { model, provider }
}

// ── State types ───────────────────────────────────────────────────────────────

type SelectionView = 'intake' | 'reviewing_proposal' | 'generating'

interface ModuleState {
  moduleView: 'project_selection' | 'active_project'
  selectionView: SelectionView
  intakeForm: CodeLearningIntakeForm | null
  proposal: ProjectProposal | null
  activeProject: Project | null
  generatedSteps: Array<{ step_number: number; title: string }>
  initialMessages: import('./CoachingChat').CoachMessage[]
  initialHintsRevealed: Record<string, number>
  experienceLevel: string
}

const INITIAL_STATE: ModuleState = {
  moduleView: 'project_selection',
  selectionView: 'intake',
  intakeForm: null,
  proposal: null,
  activeProject: null,
  generatedSteps: [],
  initialMessages: [],
  initialHintsRevealed: {},
  experienceLevel: 'some',
}

// ── Module shell ──────────────────────────────────────────────────────────────

export default function CodeLearning() {
  const [state, setState] = useState<ModuleState>(INITIAL_STATE)
  const [isGeneratingProposal, setIsGeneratingProposal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  // ── On mount: hydrate active project from DB ───────────────────────────────

  useEffect(() => {
    window.api.codeLearningGetActiveProject().then((result: unknown) => {
      if (!result) return
      const { project, activeStepMessages, hintsRevealed, experienceLevel } = result as {
        project: Project
        activeStepMessages: import('./CoachingChat').CoachMessage[]
        hintsRevealed: Record<string, number>
        experienceLevel?: string
      }
      setState(prev => ({
        ...prev,
        activeProject: project,
        moduleView: 'active_project',
        initialMessages: activeStepMessages ?? [],
        initialHintsRevealed: hintsRevealed ?? {},
        experienceLevel: experienceLevel ?? 'some',
      }))
    }).catch(() => { /* no active project */ })
  }, [])

  // ── Proposal generation ────────────────────────────────────────────────────

  async function handleIntakeSubmit(form: CodeLearningIntakeForm) {
    const result = await resolveModelInfo()
    if ('error' in result) { setError(result.error); return }
    const info = result
    setIsGeneratingProposal(true)
    setError(null)
    setState(prev => ({ ...prev, intakeForm: form }))
    try {
      const proposal = await window.api.codeLearningGenerateProposal({
        intake: form,
        model: info.model,
        provider: info.provider,
      }) as ProjectProposal
      setState(prev => ({
        ...prev,
        proposal,
        selectionView: 'reviewing_proposal',
      }))
    } catch (err) {
      setError(String(err))
    } finally {
      setIsGeneratingProposal(false)
    }
  }

  // ── Curriculum generation ──────────────────────────────────────────────────

  async function handleStartProject() {
    const result = await resolveModelInfo()
    if ('error' in result) { setError(result.error); return }
    const info = result
    if (!state.intakeForm || !state.proposal) return

    setState(prev => ({
      ...prev,
      selectionView: 'generating',
      generatedSteps: [],
    }))
    setError(null)

    // Set up streaming listeners
    const cleanupChunk = window.api.onCurriculumChunk(() => {
      // Tokens accumulate server-side; step-ready events carry the progress
    })
    const cleanupStep = window.api.onCurriculumStepReady((step: { step_number: number; title: string }) => {
      setState(prev => ({
        ...prev,
        generatedSteps: [
          ...prev.generatedSteps.filter(s => s.step_number !== step.step_number),
          step,
        ],
      }))
    })
    const cleanupDone = window.api.onCurriculumDone(async (rawProject: Record<string, unknown>) => {
      cleanupChunk()
      cleanupStep()
      cleanupDone()
      cleanupErr()

      const project = rawProject as Project
      // Save to SQLite
      await window.api.codeLearningSaveProject({
        project,
        intake: state.intakeForm,
        proposal: state.proposal,
      })
      setState(prev => ({
        ...prev,
        activeProject: project,
        moduleView: 'active_project',
      }))
    })
    const cleanupErr = window.api.onCurriculumError((err: string) => {
      cleanupChunk()
      cleanupStep()
      cleanupDone()
      cleanupErr()
      setError(`Curriculum generation failed: ${err}`)
      setState(prev => ({ ...prev, selectionView: 'reviewing_proposal' }))
    })

    window.api.codeLearningGenerateCurriculum({
      intake: state.intakeForm,
      proposal: state.proposal,
      model: info.model,
      provider: info.provider,
    })
  }

  async function handleTryAnother() {
    if (!state.intakeForm) {
      setState(prev => ({ ...prev, proposal: null, selectionView: 'intake' }))
      return
    }
    // Re-run proposal with the same form (the IPC handler gets a fresh call each time)
    await handleIntakeSubmit(state.intakeForm)
  }

  function handleEditDetails() {
    setState(prev => ({ ...prev, selectionView: 'intake' }))
  }

  function handleStartNewProject() {
    window.api.codeLearningUpdateActiveProjects([])
    setState(INITIAL_STATE)
  }

  // ── Active project view ────────────────────────────────────────────────────

  if (state.moduleView === 'active_project' && state.activeProject) {
    return (
      <>
        {showHelp && <CodeLearningHelp onClose={() => setShowHelp(false)} />}
        <ActiveProject
          project={state.activeProject}
          initialMessages={state.initialMessages}
          initialHintsRevealed={state.initialHintsRevealed}
          experienceLevel={state.experienceLevel}
          onStartNew={handleStartNewProject}
          onHelp={() => setShowHelp(true)}
        />
      </>
    )
  }

  // ── Project selection flow ─────────────────────────────────────────────────

  const subtitle = {
    intake: 'Tell me what you want to build.',
    reviewing_proposal: 'Review your project proposal.',
    generating: 'Building your curriculum\u2026',
  }[state.selectionView]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {showHelp && <CodeLearningHelp onClose={() => setShowHelp(false)} />}

      {/* Module header */}
      <div className="px-6 py-4 border-b border-border flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-text">Code Learning</h1>
          <p className="text-xs text-text-dim mt-0.5">{subtitle}</p>
        </div>
        <button
          onClick={() => setShowHelp(true)}
          className="btn-ghost text-xs flex-shrink-0"
          title="How it works"
        >
          <HelpCircle size={14} />
          Help
        </button>
      </div>

      {/* Error toast */}
      {error && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded-md bg-error/10 border border-error/20 text-sm text-error flex-shrink-0">
          {error}
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">

          {state.selectionView === 'intake' && (
            <IntakeForm
              initialValues={state.intakeForm ?? undefined}
              onSubmit={handleIntakeSubmit}
              isLoading={isGeneratingProposal}
            />
          )}

          {state.selectionView === 'reviewing_proposal' && state.proposal && (
            <ProposalCard
              proposal={state.proposal}
              onStart={handleStartProject}
              onTryAnother={handleTryAnother}
              onEditDetails={handleEditDetails}
            />
          )}

          {state.selectionView === 'generating' && state.proposal && (
            <CurriculumGenerating
              projectTitle={state.proposal.title}
              completedSteps={state.generatedSteps}
              estimatedTotal={state.proposal.estimated_steps}
            />
          )}

        </div>
      </div>

    </div>
  )
}
