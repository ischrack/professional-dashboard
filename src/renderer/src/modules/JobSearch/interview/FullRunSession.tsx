import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Pause, XCircle, Loader2, CheckCircle, MessageSquare, FileText } from 'lucide-react'
import clsx from 'clsx'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { InterviewSession, InterviewExchange, Job, InterviewBrief } from '@shared/types'
import { useToast } from '../../../shared/hooks/useToast'

const MINI_DEBRIEF_THRESHOLD = 5

interface ChatMessage {
  role: 'interviewer' | 'user'
  content: string
}

interface FullRunSessionProps {
  session: InterviewSession
  exchanges: InterviewExchange[]
  job: Job
  brief: InterviewBrief | null
  settings: Record<string, unknown>
  onSessionUpdate: (session: InterviewSession) => void
  onExchangeSaved: () => void
}

type ViewMode = 'chat' | 'debrief'

export default function FullRunSession({
  session,
  exchanges,
  job,
  brief,
  settings,
  onSessionUpdate,
  onExchangeSaved,
}: FullRunSessionProps) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [answer, setAnswer] = useState('')
  const [questionNumber, setQuestionNumber] = useState(1)
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [debriefText, setDebriefText] = useState(session.debriefText || '')
  const [isComplete, setIsComplete] = useState(session.status === 'completed')
  const [isGeneratingDebrief, setIsGeneratingDebrief] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(session.status === 'completed' ? 'debrief' : 'chat')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void)[]>([])
  const streamAccRef = useRef('')

  const models = (settings.models as Record<string, string>) || {}
  const model = models.interviewResearch || 'claude-sonnet-4-6'
  const provider: 'anthropic' | 'openai' = model.startsWith('gpt') ? 'openai' : 'anthropic'

  useEffect(() => {
    if (exchanges.length > 0) {
      const rebuilt: ChatMessage[] = []
      for (const ex of exchanges) {
        rebuilt.push({ role: 'interviewer', content: ex.questionText })
        if (ex.answerText) rebuilt.push({ role: 'user', content: ex.answerText })
      }
      setMessages(rebuilt)
      setQuestionNumber(exchanges.length + 1)
    } else if (session.status !== 'completed') {
      askNextQuestion([])
    }

    return () => {
      cleanupRef.current.forEach(fn => fn())
      cleanupRef.current = []
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming, debriefText])

  function buildSystemPrompt(): string {
    const briefText = brief ? `\n\nResearch Brief:\n${brief.content.slice(0, 6000)}` : '\n\n(No research brief.)'
    const categoryList = session.categories.join(', ')

    return `You are a professional job interviewer conducting a full mock interview for: ${job.title} at ${job.company}.

Ask one question at a time. Do NOT provide feedback between questions — just ask the next question after receiving each answer.
Stay in character throughout. Do not break the interview flow.

Question categories: ${categoryList}

The final section is "Questions to Ask the Interviewer" — ask "Now let's practice — what would you ask me?" and respond as an interviewer would.

When all categories are covered, output exactly: [SESSION_COMPLETE]

Job Description: ${(job.description || 'Not provided').slice(0, 2000)}${briefText}

Keep questions realistic, professional, and varied.`
  }

  function buildDebriefSystemPrompt(answeredCount: number): string {
    const isMini = answeredCount < MINI_DEBRIEF_THRESHOLD
    return `You are providing interview feedback to a candidate after a mock interview for: ${job.title} at ${job.company}.

${isMini ? `The candidate ended the session early after only ${answeredCount} questions. Provide a shorter debrief.` : 'Provide a comprehensive debrief based on all the answers given.'}

Structure your debrief in markdown with these sections:
## Overall Impression
2-3 sentences on how the candidate performed overall.

## Per-Question Feedback
For each question answered, provide brief Strength and Improvement notes.

## ${isMini ? 'Top Priority' : 'Top 3 Priority Areas'}
${isMini ? '1-2 most important areas to work on.' : 'The 3 most important areas to work on before the real interview.'}

## Suggested Improvements
Stronger versions of the 2-3 weakest responses.

Be specific, constructive, and actionable.`
  }

  const askNextQuestion = useCallback(async (currentMessages: ChatMessage[]) => {
    setIsStreaming(true)
    streamAccRef.current = ''

    const apiMessages = currentMessages.map(m => ({
      role: m.role === 'interviewer' ? 'assistant' as const : 'user' as const,
      content: m.content,
    }))

    if (apiMessages.length === 0) {
      apiMessages.push({ role: 'user', content: 'Please begin the interview.' })
    }

    cleanupRef.current.forEach(fn => fn())
    cleanupRef.current = []

    let accumulated = ''

    const unToken = window.api.onInterviewChatToken((token: string) => {
      accumulated += token
      streamAccRef.current += token
    })

    const unDone = window.api.onInterviewChatDone(() => {
      setIsStreaming(false)
      const content = streamAccRef.current

      if (content.includes('[SESSION_COMPLETE]')) {
        const cleanContent = content.replace('[SESSION_COMPLETE]', '').trim()
        if (cleanContent) {
          setMessages(prev => [...prev, { role: 'interviewer', content: cleanContent }])
        }
        generateDebrief(currentMessages)
        return
      }

      setMessages(prev => {
        const updated = [...prev, { role: 'interviewer' as const, content: content.trim() }]
        return updated
      })
      setQuestionNumber(n => n + 1)
    })

    const unError = window.api.onInterviewStreamError((err: string) => {
      toast('error', `Interview error: ${err}`)
      setIsStreaming(false)
    })

    cleanupRef.current = [unToken, unDone, unError]

    window.api.interviewSendChat({
      sessionId: session.id,
      model,
      provider,
      systemPrompt: buildSystemPrompt(),
      messages: apiMessages,
    })
  }, [session, job, brief, settings, model, provider])

  const generateDebrief = useCallback(async (allMessages: ChatMessage[]) => {
    setIsGeneratingDebrief(true)
    setViewMode('debrief')

    const answeredCount = allMessages.filter(m => m.role === 'user').length
    const transcript = allMessages.map(m => `${m.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${m.content}`).join('\n\n')

    cleanupRef.current.forEach(fn => fn())
    cleanupRef.current = []

    let debriefAcc = ''

    const unToken = window.api.onInterviewChatToken((token: string) => {
      debriefAcc += token
      setDebriefText(debriefAcc)
    })

    const unDone = window.api.onInterviewChatDone(async () => {
      setIsGeneratingDebrief(false)
      setIsComplete(true)
      await window.api.interviewUpdateSession(session.id, { status: 'completed', debriefText: debriefAcc })
      onSessionUpdate({ ...session, status: 'completed', debriefText: debriefAcc })
      window.dispatchEvent(new CustomEvent('interview-session-changed'))
    })

    const unError = window.api.onInterviewStreamError((err: string) => {
      toast('error', `Debrief error: ${err}`)
      setIsGeneratingDebrief(false)
    })

    cleanupRef.current = [unToken, unDone, unError]

    window.api.interviewSendChat({
      sessionId: session.id,
      model,
      provider,
      systemPrompt: buildDebriefSystemPrompt(answeredCount),
      messages: [{ role: 'user', content: `Here is the full interview transcript:\n\n${transcript}\n\nPlease provide the interview debrief.` }],
    })
  }, [session, job, settings, model, provider])

  async function handleSubmit() {
    if (!answer.trim() || isStreaming) return
    const trimmed = answer.trim()
    setAnswer('')

    const userMessage: ChatMessage = { role: 'user', content: trimmed }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)

    // Save exchange
    const questionMsg = messages.filter(m => m.role === 'interviewer').slice(-1)[0]
    if (questionMsg) {
      await window.api.interviewSaveExchange({
        sessionId: session.id,
        sequence: messages.filter(m => m.role === 'user').length,
        questionText: questionMsg.content,
        answerText: trimmed,
      })
      onExchangeSaved()
    }

    await askNextQuestion(newMessages)
  }

  async function handlePause() {
    await window.api.interviewUpdateSession(session.id, { status: 'paused' })
    onSessionUpdate({ ...session, status: 'paused' })
    window.dispatchEvent(new CustomEvent('interview-session-changed'))
    toast('success', 'Session paused.')
  }

  async function handleEndEarly() {
    setConfirmEnd(false)
    generateDebrief(messages)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with tab switcher if complete */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <MessageSquare size={14} className="text-accent" />
          <span className="text-xs font-semibold text-text">Full Run</span>
          {!isComplete && <span className="text-xs text-text-dim">— Question {questionNumber}</span>}
          {isComplete && <span className="badge badge-success text-[10px]">Complete</span>}

          {isComplete && (
            <div className="flex bg-surface-2 rounded-md p-0.5 ml-2">
              <button
                onClick={() => setViewMode('debrief')}
                className={clsx('px-2 py-1 rounded text-xs transition-colors', viewMode === 'debrief' ? 'bg-surface text-text' : 'text-text-dim hover:text-text')}
              >
                Debrief
              </button>
              <button
                onClick={() => setViewMode('chat')}
                className={clsx('px-2 py-1 rounded text-xs transition-colors', viewMode === 'chat' ? 'bg-surface text-text' : 'text-text-dim hover:text-text')}
              >
                Transcript
              </button>
            </div>
          )}
        </div>

        {!isComplete && !isGeneratingDebrief && (
          <div className="flex gap-2">
            <button onClick={handlePause} className="btn-ghost text-xs flex items-center gap-1">
              <Pause size={12} />Pause
            </button>
            {confirmEnd ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-dim">End & get debrief?</span>
                <button onClick={handleEndEarly} className="btn-danger text-xs">End</button>
                <button onClick={() => setConfirmEnd(false)} className="btn-ghost text-xs">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmEnd(true)} className="btn-ghost text-xs flex items-center gap-1 text-text-dim">
                <XCircle size={12} />End Early
              </button>
            )}
          </div>
        )}
      </div>

      {/* Debrief view */}
      {(viewMode === 'debrief') && (
        <div className="flex-1 overflow-y-auto p-4">
          {isGeneratingDebrief && !debriefText && (
            <div className="flex items-center gap-2 text-text-dim">
              <Loader2 size={14} className="animate-spin text-accent" />
              <span className="text-sm">Generating debrief...</span>
            </div>
          )}
          {debriefText && (
            <div className="space-y-2">
              {isGeneratingDebrief && (
                <div className="flex items-center gap-2 text-accent mb-3">
                  <Loader2 size={12} className="animate-spin" />
                  <span className="text-xs">Generating...</span>
                </div>
              )}
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h2: ({ children }) => <h2 className="text-sm font-semibold text-text mt-4 mb-2 first:mt-0">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mt-3 mb-1">{children}</h3>,
                  p: ({ children }) => <p className="text-sm text-text-muted leading-relaxed mb-2">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc list-outside ml-4 space-y-1 mb-2">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-outside ml-4 space-y-1 mb-2">{children}</ol>,
                  li: ({ children }) => <li className="text-sm text-text-muted leading-relaxed">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
                  blockquote: ({ children }) => <blockquote className="border-l-2 border-accent/40 pl-3 italic text-text-dim my-2">{children}</blockquote>,
                }}
              >
                {debriefText}
              </ReactMarkdown>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      )}

      {/* Chat/transcript view */}
      {viewMode === 'chat' && (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg, i) => (
              msg.role === 'interviewer' ? (
                <div key={i} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-accent">I</span>
                  </div>
                  <div className="flex-1 bg-surface-2 rounded-lg px-3 py-2.5 max-w-[85%]">
                    <p className="text-sm text-text leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              ) : (
                <div key={i} className="flex gap-3 justify-end">
                  <div className="flex-1 bg-accent/10 border border-accent/20 rounded-lg px-3 py-2.5 max-w-[85%]">
                    <p className="text-sm text-text leading-relaxed">{msg.content}</p>
                  </div>
                  <div className="w-6 h-6 rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-text-dim">Y</span>
                  </div>
                </div>
              )
            ))}

            {isStreaming && (
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-accent">I</span>
                </div>
                <div className="bg-surface-2 rounded-lg px-3 py-2.5">
                  <Loader2 size={12} className="animate-spin text-accent" />
                </div>
              </div>
            )}

            {isComplete && (
              <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/20 rounded-lg">
                <CheckCircle size={14} className="text-success" />
                <p className="text-sm text-success font-medium">Session complete!</p>
              </div>
            )}

            <div ref={scrollRef} />
          </div>

          {!isComplete && !isGeneratingDebrief && (
            <div className="p-3 border-t border-border flex-shrink-0">
              <div className="flex gap-2">
                <textarea
                  value={answer}
                  onChange={e => setAnswer(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSubmit()
                    }
                  }}
                  placeholder="Type your answer... (Enter to submit)"
                  disabled={isStreaming}
                  className="flex-1 input resize-none text-sm"
                  rows={3}
                />
                <button
                  onClick={handleSubmit}
                  disabled={!answer.trim() || isStreaming}
                  className="btn-primary flex-shrink-0 self-end"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
