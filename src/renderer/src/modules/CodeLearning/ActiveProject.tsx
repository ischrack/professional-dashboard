import React, { useState, useRef, useEffect } from 'react'
import { Plus, FolderOpen, Wifi, WifiOff, HelpCircle } from 'lucide-react'
import type { Project, ProjectStep, FeedbackResponse } from '@shared/types'
import StepView from './StepView'
import CoachingChat, { type CoachMessage } from './CoachingChat'
import StepList from './StepList'
import { useVSCodeBridge } from '../../hooks/useVSCodeBridge'
import { inferProvider } from '../../shared/utils/llm'

// ── Model resolution ──────────────────────────────────────────────────────────

interface ModelInfo { model: string; provider: 'anthropic' | 'openai' }

type ModelInfoResult = ModelInfo | { error: string }

async function resolveModelInfo(): Promise<ModelInfoResult> {
  const settings = await window.api.getSettings() as Record<string, unknown>
  const models = settings.models as Record<string, string> | undefined
  const model = models?.codeLearning || 'claude-opus-4-6'
  const provider = inferProvider(model)
  console.log('[ActiveProject resolveModelInfo] model:', model, '| provider:', provider)
  const apiKey = await window.api.getApiKey(provider === 'openai' ? 'openaiKey' : 'anthropicKey') as string
  if (!apiKey) {
    const providerLabel = provider === 'openai' ? 'OpenAI' : 'Anthropic'
    console.warn('[ActiveProject resolveModelInfo] no key for provider:', providerLabel, '| full models object:', models)
    return { error: `No ${providerLabel} API key found for model "${model}". Add your key in Settings → API Keys.` }
  }
  return { model, provider }
}

// ── Streaming ID sentinel ─────────────────────────────────────────────────────

const STREAMING_ID = '__streaming__'

// ── Props ─────────────────────────────────────────────────────────────────────

interface ActiveProjectProps {
  project: Project
  initialMessages?: CoachMessage[]
  initialHintsRevealed?: Record<string, number>
  experienceLevel?: string
  onStartNew: () => void
  onHelp?: () => void
}

export default function ActiveProject({
  project,
  initialMessages,
  initialHintsRevealed,
  experienceLevel = 'some',
  onStartNew,
  onHelp,
}: ActiveProjectProps) {
  const [steps, setSteps] = useState<ProjectStep[]>(project.steps)

  const initialStep = project.steps.find(s => s.status === 'active') ?? project.steps[0]
  const [currentStepId, setCurrentStepId] = useState(initialStep.id)

  // Per-step hint reveal counts: { stepId → count }
  const [hintsRevealed, setHintsRevealed] = useState<Record<string, number>>(
    initialHintsRevealed ?? {}
  )

  // Per-step coaching chat messages: { stepId → CoachMessage[] }
  const [chatMessages, setChatMessages] = useState<Record<string, CoachMessage[]>>(() => {
    if (initialMessages && initialMessages.length > 0) {
      return { [initialStep.id]: initialMessages }
    }
    return {}
  })

  // Track which steps we've already loaded messages for
  const [loadedSteps, setLoadedSteps] = useState<Set<string>>(
    new Set([initialStep.id])
  )

  // Step IDs whose context block has been viewed at least once
  const [contextSeen, setContextSeen] = useState<Set<string>>(new Set())

  // Loading states
  const [isReviewing, setIsReviewing] = useState(false)
  const [isCoaching, setIsCoaching] = useState(false)

  // VS Code bridge
  const { connected, lastMessage, sendToVSCode } = useVSCodeBridge()

  // Ref to the coaching chat for "Ask the coach" scroll
  const chatRef = useRef<HTMLDivElement>(null)

  // ── VS Code bridge: inbound messages ──────────────────────────────────────

  useEffect(() => {
    if (!lastMessage) return

    if (lastMessage.type === 'hello') {
      sendToVSCode({
        type: 'ack',
        activeStepId: currentStepId,
        targetFile: steps.find(s => s.id === currentStepId)?.target_file ?? null,
      })
    } else if (lastMessage.type === 'step_complete' && lastMessage.projectId === project.id) {
      const idx = steps.findIndex(s => s.id === lastMessage.stepId)
      if (idx >= 0 && steps[idx].status !== 'completed') {
        const completedAt = new Date().toISOString()
        const updated = steps.map((s, i) => {
          if (i === idx) return { ...s, status: 'completed' as const, completion_method: 'vscode' as const, completed_at: completedAt }
          if (i === idx + 1 && s.status === 'locked') return { ...s, status: 'active' as const }
          return s
        })
        setSteps(updated)
        persistStepComplete(lastMessage.stepId, 'vscode', completedAt)
        if (idx + 1 < steps.length) {
          setCurrentStepId(steps[idx + 1].id)
          persistStepActivate(steps[idx + 1].id)
        }
      }
    } else if (lastMessage.type === 'file_contents' && lastMessage.projectId === project.id) {
      // File arrived — run the LLM review
      runCodeReview(lastMessage.content, lastMessage.stepId)
    }
  }, [lastMessage]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync step context to extension on step change ─────────────────────────

  useEffect(() => {
    const step = steps.find(s => s.id === currentStepId)
    window.api.codeLearningUpdateActiveProjects([{
      id: project.id,
      folderPath: project.project_folder_path,
      activeStepId: currentStepId,
      targetFile: step?.target_file ?? null,
    }])
    if (connected) {
      sendToVSCode({
        type: 'step_context',
        stepId: currentStepId,
        targetFile: step?.target_file ?? null,
        targetFunctionOrBlock: step?.target_function_or_block ?? null,
      })
    }
    // Lazy-load messages for this step if not yet fetched
    if (!loadedSteps.has(currentStepId)) {
      window.api.codeLearningGetStepMessages(currentStepId).then((msgs: unknown) => {
        if (Array.isArray(msgs) && msgs.length > 0) {
          setChatMessages(prev => ({ ...prev, [currentStepId]: msgs as CoachMessage[] }))
        }
        setLoadedSteps(prev => new Set([...prev, currentStepId]))
      }).catch(() => {
        setLoadedSteps(prev => new Set([...prev, currentStepId]))
      })
    }
  }, [currentStepId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── DB persistence helpers ────────────────────────────────────────────────

  function persistStepComplete(stepId: string, method: 'manual' | 'vscode', completedAt: string) {
    window.api.codeLearningUpdateStep({
      stepId,
      projectId: project.id,
      status: 'completed',
      completion_method: method,
      completed_at: completedAt,
    })
  }

  function persistStepActivate(stepId: string) {
    window.api.codeLearningUpdateStep({ stepId, projectId: project.id, status: 'active' })
  }

  function persistMessage(msg: CoachMessage, stepId: string) {
    const content = msg.role === 'feedback'
      ? JSON.stringify(msg.feedback)
      : (msg as { id: string; role: 'user' | 'assistant'; content: string }).content
    window.api.codeLearningSaveMessage({
      id: msg.id,
      stepId,
      projectId: project.id,
      role: msg.role,
      content,
    })
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const currentStep = steps.find(s => s.id === currentStepId) ?? steps[0]
  const completedCount = steps.filter(s => s.status === 'completed').length
  const currentHintsRevealed = hintsRevealed[currentStepId] ?? 0
  const currentMessages = chatMessages[currentStepId] ?? []

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleRevealHint() {
    if (currentHintsRevealed >= currentStep.hints.length) return
    const next = (hintsRevealed[currentStepId] ?? 0) + 1
    setHintsRevealed(prev => ({ ...prev, [currentStepId]: next }))
    window.api.codeLearningUpdateHints({ stepId: currentStepId, projectId: project.id, hintsRevealed: next })
  }

  function handleMarkComplete() {
    const idx = steps.findIndex(s => s.id === currentStepId)
    if (idx < 0) return
    const completedAt = new Date().toISOString()
    const updated = steps.map((s, i) => {
      if (i === idx) return { ...s, status: 'completed' as const, completion_method: 'manual' as const, completed_at: completedAt }
      if (i === idx + 1 && s.status === 'locked') return { ...s, status: 'active' as const }
      return s
    })
    setSteps(updated)
    persistStepComplete(currentStepId, 'manual', completedAt)
    if (idx + 1 < steps.length) {
      setCurrentStepId(steps[idx + 1].id)
      persistStepActivate(steps[idx + 1].id)
    }
  }

  function handleContextViewed() {
    setContextSeen(prev => new Set([...prev, currentStepId]))
  }

  function scrollToChat() {
    chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ── Coaching chat (streaming) ─────────────────────────────────────────────

  async function handleSendMessage(text: string) {
    const result = await resolveModelInfo()
    if ('error' in result) return
    const info = result

    const userMsg: CoachMessage = { id: `${Date.now()}-user`, role: 'user', content: text }
    const streamingMsg: CoachMessage = { id: STREAMING_ID, role: 'assistant', content: '' }

    setChatMessages(prev => ({
      ...prev,
      [currentStepId]: [...(prev[currentStepId] ?? []), userMsg, streamingMsg],
    }))
    persistMessage(userMsg, currentStepId)
    setIsCoaching(true)

    // Build history: user/assistant only (no feedback cards)
    const history = (chatMessages[currentStepId] ?? [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: (m as { content: string }).content }))

    const cleanupChunk = window.api.onCoachingChunk((token: string) => {
      setChatMessages(prev => {
        const msgs = prev[currentStepId] ?? []
        return {
          ...prev,
          [currentStepId]: msgs.map(m =>
            m.id === STREAMING_ID
              ? { ...m, content: (m as { content: string }).content + token }
              : m
          ),
        }
      })
    })

    const cleanupDone = window.api.onCoachingDone((result: { content: string }) => {
      cleanupChunk()
      cleanupDone()
      cleanupErr()
      const finalMsg: CoachMessage = { id: `${Date.now()}-assistant`, role: 'assistant', content: result.content }
      setChatMessages(prev => ({
        ...prev,
        [currentStepId]: (prev[currentStepId] ?? [])
          .filter(m => m.id !== STREAMING_ID)
          .concat(finalMsg),
      }))
      persistMessage(finalMsg, currentStepId)
      setIsCoaching(false)
    })

    const cleanupErr = window.api.onCoachingError(() => {
      cleanupChunk()
      cleanupDone()
      cleanupErr()
      setChatMessages(prev => ({
        ...prev,
        [currentStepId]: (prev[currentStepId] ?? []).filter(m => m.id !== STREAMING_ID),
      }))
      setIsCoaching(false)
    })

    window.api.codeLearningCoachingMessage({
      step: currentStep,
      project,
      history,
      userMessage: text,
      experienceLevel,
      model: info.model,
      provider: info.provider,
    })
  }

  // ── Code review ───────────────────────────────────────────────────────────

  async function runCodeReview(fileContent: string, stepId: string) {
    const result = await resolveModelInfo()
    if ('error' in result) { setIsReviewing(false); return }
    const info = result

    const step = steps.find(s => s.id === stepId) ?? currentStep
    try {
      const feedback = await window.api.codeLearningReviewCode({
        step,
        project,
        fileContent,
        experienceLevel,
        model: info.model,
        provider: info.provider,
      }) as FeedbackResponse

      const feedbackMsg: CoachMessage = {
        id: `${Date.now()}-feedback`,
        role: 'feedback',
        feedback,
      }
      setChatMessages(prev => ({
        ...prev,
        [stepId]: [...(prev[stepId] ?? []), feedbackMsg],
      }))
      persistMessage(feedbackMsg, stepId)
    } catch {
      // Silently drop — user can try again
    } finally {
      setIsReviewing(false)
    }
  }

  function handleReviewCode() {
    const step = steps.find(s => s.id === currentStepId)
    if (!step?.target_file) return
    setIsReviewing(true)
    if (connected) {
      sendToVSCode({ type: 'request_file', stepId: currentStepId, filePath: step.target_file })
      // Response handled in lastMessage effect → runCodeReview
    } else {
      setIsReviewing(false)
    }
  }

  function handleOpenInVSCode() {
    if (project.project_folder_path) {
      window.api.codeLearningOpenInVSCode(project.project_folder_path)
    }
  }

  function handleStepClick(stepId: string) {
    const step = steps.find(s => s.id === stepId)
    if (!step || step.status === 'locked') return
    setCurrentStepId(stepId)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel — 60% ───────────────────────────────────────────────── */}
      <div className="flex-[3] min-w-0 flex flex-col overflow-hidden border-r border-border">

        {/* Panel header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-semibold text-text truncate min-w-0">{project.title}</h2>
          <div className="flex items-center gap-1 flex-shrink-0 ml-3">
            {onHelp && (
              <button onClick={onHelp} className="btn-ghost text-xs" title="How it works">
                <HelpCircle size={12} />
              </button>
            )}
            <button onClick={onStartNew} className="btn-ghost text-xs">
              <Plus size={12} />
              New Project
            </button>
          </div>
        </div>

        {/* Scrollable step + chat */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-5">
            <StepView
              key={currentStep.id}
              step={currentStep}
              stepTotal={steps.length}
              hintsRevealed={currentHintsRevealed}
              contextInitiallyOpen={!contextSeen.has(currentStepId)}
              onRevealHint={handleRevealHint}
              onMarkComplete={handleMarkComplete}
              onScrollToChat={scrollToChat}
              onContextViewed={handleContextViewed}
            />
          </div>

          {/* Coaching chat — ref target for "Ask the coach" scroll */}
          <div ref={chatRef} className="border-t border-border">
            <CoachingChat
              stepId={currentStepId}
              messages={currentMessages}
              isReviewing={isReviewing}
              isCoaching={isCoaching}
              onSendMessage={handleSendMessage}
              onReviewCode={handleReviewCode}
            />
          </div>
        </div>
      </div>

      {/* ── Right panel — 40% ──────────────────────────────────────────────── */}
      <div className="flex-[2] min-w-0 flex flex-col overflow-hidden">

        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-xs font-semibold text-text-dim uppercase tracking-wider">
              Project Overview
            </p>
            <span
              className={connected ? 'text-success' : 'text-text-dim'}
              title={connected ? 'VS Code extension connected' : 'VS Code extension not connected'}
            >
              {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
            </span>
          </div>
          <button
            onClick={handleOpenInVSCode}
            className="btn-ghost text-xs"
            title={project.project_folder_path ?? 'No folder set'}
          >
            <FolderOpen size={12} />
            Open in VS Code
          </button>
        </div>

        {/* Step list + progress */}
        <div className="flex-1 overflow-y-auto">
          <StepList
            project={project}
            steps={steps}
            currentStepId={currentStepId}
            completedCount={completedCount}
            onStepClick={handleStepClick}
          />
        </div>
      </div>

    </div>
  )
}
