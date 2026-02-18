import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Pause, XCircle, Loader2, CheckCircle, ThumbsUp, TrendingUp, Lightbulb, MessageSquare } from 'lucide-react'
import clsx from 'clsx'
import type { InterviewSession, InterviewExchange, InterviewCategory, LiveFeedbackResponse, LiveFeedbackBlock, Job, InterviewBrief } from '@shared/types'
import { useToast } from '../../../shared/hooks/useToast'

const MINI_DEBRIEF_THRESHOLD = 5

interface FeedbackCardProps {
  feedback: LiveFeedbackBlock
  isQuestionsSection: boolean
}

function FeedbackCard({ feedback, isQuestionsSection }: FeedbackCardProps) {
  const [visible, setVisible] = useState(false)
  const [showImprovement, setShowImprovement] = useState(false)
  const [showRefinement, setShowRefinement] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 50)
    const t2 = setTimeout(() => setShowImprovement(true), 400)
    const t3 = setTimeout(() => setShowRefinement(true), 800)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  return (
    <div className={clsx('space-y-2 transition-opacity duration-300', visible ? 'opacity-100' : 'opacity-0')}>
      {isQuestionsSection ? (
        // Different rubric for "questions to ask" section
        <>
          <div className="flex items-start gap-2 p-3 bg-success/10 border border-success/20 rounded-lg">
            <CheckCircle size={14} className="text-success flex-shrink-0 mt-0.5" />
            <p className="text-xs text-text leading-relaxed">{feedback.strength}</p>
          </div>
          {showImprovement && (
            <div className="flex items-start gap-2 p-3 bg-surface-2 border border-border rounded-lg transition-opacity duration-300">
              <TrendingUp size={14} className="text-accent flex-shrink-0 mt-0.5" />
              <p className="text-xs text-text leading-relaxed">{feedback.improvement}</p>
            </div>
          )}
          {showRefinement && feedback.suggestedRefinement && (
            <div className="flex items-start gap-2 p-3 bg-accent/5 border border-accent/20 rounded-lg transition-opacity duration-300">
              <Lightbulb size={14} className="text-accent flex-shrink-0 mt-0.5" />
              <p className="text-xs text-text-muted leading-relaxed italic">{feedback.suggestedRefinement}</p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-start gap-2 p-3 bg-success/10 border border-success/20 rounded-lg">
            <ThumbsUp size={14} className="text-success flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-semibold text-success uppercase tracking-wider mb-0.5">Strength</p>
              <p className="text-xs text-text leading-relaxed">{feedback.strength}</p>
            </div>
          </div>
          {showImprovement && (
            <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg transition-opacity duration-300">
              <TrendingUp size={14} className="text-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-semibold text-warning uppercase tracking-wider mb-0.5">Improvement</p>
                <p className="text-xs text-text leading-relaxed">{feedback.improvement}</p>
              </div>
            </div>
          )}
          {showRefinement && feedback.suggestedRefinement && (
            <div className="flex items-start gap-2 p-3 bg-accent/5 border border-accent/20 rounded-lg transition-opacity duration-300">
              <Lightbulb size={14} className="text-accent flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-semibold text-accent uppercase tracking-wider mb-0.5">Suggested refinement</p>
                <p className="text-xs text-text-muted leading-relaxed italic">{feedback.suggestedRefinement}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface ChatMessage {
  role: 'interviewer' | 'user' | 'feedback'
  content: string
  feedback?: LiveFeedbackBlock
  isQuestionsSection?: boolean
  streaming?: boolean
}

interface LiveFeedbackSessionProps {
  session: InterviewSession
  exchanges: InterviewExchange[]
  job: Job
  brief: InterviewBrief | null
  settings: Record<string, unknown>
  onSessionUpdate: (session: InterviewSession) => void
  onExchangeSaved: () => void
}

export default function LiveFeedbackSession({
  session,
  exchanges,
  job,
  brief,
  settings,
  onSessionUpdate,
  onExchangeSaved,
}: LiveFeedbackSessionProps) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [answer, setAnswer] = useState('')
  const [questionNumber, setQuestionNumber] = useState(1)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamBuffer, setStreamBuffer] = useState('')
  const [currentParsedResponse, setCurrentParsedResponse] = useState<LiveFeedbackResponse | null>(null)
  const [waitingForParse, setWaitingForParse] = useState(false)
  const [isComplete, setIsComplete] = useState(session.status === 'completed')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void)[]>([])
  const streamAccRef = useRef('')

  const models = (settings.models as Record<string, string>) || {}
  const model = models.interviewResearch || 'claude-sonnet-4-6'
  const provider: 'anthropic' | 'openai' = model.startsWith('gpt') ? 'openai' : 'anthropic'

  useEffect(() => {
    // Initialize from existing exchanges
    if (exchanges.length > 0) {
      const rebuilt: ChatMessage[] = []
      for (const ex of exchanges) {
        rebuilt.push({ role: 'interviewer', content: ex.questionText })
        if (ex.answerText) {
          rebuilt.push({ role: 'user', content: ex.answerText })
          if (ex.feedbackJson) {
            try {
              const parsed: LiveFeedbackResponse = JSON.parse(ex.feedbackJson)
              if (parsed.feedback) {
                rebuilt.push({
                  role: 'feedback',
                  content: '',
                  feedback: parsed.feedback,
                  isQuestionsSection: parsed.questionType === 'questions_to_ask',
                })
              }
            } catch { /* ignore */ }
          }
        }
      }
      setMessages(rebuilt)
      setQuestionNumber(exchanges.length + 1)
    } else if (session.status !== 'completed') {
      // New session — ask first question
      askNextQuestion(null, [])
    }

    return () => {
      cleanupRef.current.forEach(fn => fn())
      cleanupRef.current = []
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuffer])

  function buildSystemPrompt(): string {
    const resumeMat = '' // Could load from API if needed
    const briefText = brief ? `\n\n## Research Brief\n${brief.content.slice(0, 6000)}` : '\n\n(No research brief available for this session.)'
    const categoryList = session.categories.join(', ')

    return `You are a professional, realistic job interviewer conducting a mock interview for a candidate applying to: ${job.title} at ${job.company}.

Your role: Ask one question at a time. After receiving the candidate's answer, provide structured JSON feedback AND the next question.

Job Description: ${(job.description || 'Not provided').slice(0, 2000)}${briefText}

Question categories to cover in this session: ${categoryList}
Questions to Ask the Interviewer is always the final section — when you reach it, ask "Now let's practice — what would you ask me as the interviewer?" and evaluate the quality of their questions based on research depth, curiosity, and strategic thinking.

RESPONSE FORMAT: Return valid JSON matching this schema:
{
  "feedback": {
    "strength": "1-2 sentence strength",
    "improvement": "1-2 sentence improvement area",
    "suggestedRefinement": "optional 2-4 sentence refinement (omit if not needed)"
  } | null,
  "nextQuestion": "the next interview question as a string" | null,
  "sessionComplete": false,
  "questionType": "behavioral" | "technical" | "culture_fit" | "role_specific" | "curveball" | "questions_to_ask"
}

For "questions_to_ask" questionType: evaluate whether the candidate's question demonstrates research, genuine curiosity, and strategic thinking (not the STAR rubric).

When all categories have been covered, set sessionComplete: true and nextQuestion: null.
feedback is null only for the very first question (no prior answer to evaluate).

${resumeMat ? `Candidate resume context:\n${resumeMat}` : ''}

Keep questions realistic and professional. Vary phrasing naturally. For behavioral questions, note in feedback if the STAR structure was missing.`
  }

  const askNextQuestion = useCallback(async (lastAnswer: string | null, currentMessages: ChatMessage[]) => {
    setIsStreaming(true)
    setWaitingForParse(false)
    streamAccRef.current = ''
    setStreamBuffer('')

    const apiMessages: { role: 'user' | 'assistant'; content: string }[] = []

    // Build conversation history for the API
    for (const msg of currentMessages) {
      if (msg.role === 'interviewer') {
        apiMessages.push({ role: 'assistant', content: msg.content })
      } else if (msg.role === 'user') {
        apiMessages.push({ role: 'user', content: msg.content })
      }
      // feedback messages are not sent to the API (they're derived from assistant JSON)
    }

    if (lastAnswer !== null) {
      apiMessages.push({ role: 'user', content: lastAnswer })
    } else if (apiMessages.length === 0) {
      // First question
      apiMessages.push({ role: 'user', content: 'Please begin the interview.' })
    }

    // Clean up old listeners
    cleanupRef.current.forEach(fn => fn())
    cleanupRef.current = []

    const unToken = window.api.onInterviewChatToken((token: string) => {
      streamAccRef.current += token
      setStreamBuffer(acc => acc + token)
    })

    const unDone = window.api.onInterviewChatDone((result: Record<string, unknown>) => {
      const fullContent = (result.content as string) || streamAccRef.current
      setIsStreaming(false)
      setWaitingForParse(true)
      setStreamBuffer('')

      // Parse JSON response
      let parsed: LiveFeedbackResponse | null = null
      try {
        // Extract JSON from response (may have wrapping text)
        const jsonMatch = fullContent.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0])
        }
      } catch {
        toast('error', 'Could not parse interview response. The model may have returned invalid JSON.')
        setIsStreaming(false)
        setWaitingForParse(false)
        return
      }

      if (!parsed) {
        setIsStreaming(false)
        setWaitingForParse(false)
        return
      }

      setCurrentParsedResponse(parsed)
      setWaitingForParse(false)

      // Build new messages to display
      const newMessages: ChatMessage[] = []

      if (parsed.feedback && lastAnswer !== null) {
        newMessages.push({
          role: 'feedback',
          content: '',
          feedback: parsed.feedback,
          isQuestionsSection: parsed.questionType === 'questions_to_ask',
        })
      }

      if (parsed.nextQuestion) {
        newMessages.push({ role: 'interviewer', content: parsed.nextQuestion })
      }

      setMessages(prev => [...prev, ...newMessages])

      // Save exchange to DB
      if (lastAnswer !== null) {
        const seqNum = exchanges.length + Math.floor(currentMessages.filter(m => m.role === 'user').length)
        window.api.interviewSaveExchange({
          sessionId: session.id,
          sequence: seqNum,
          questionText: currentMessages.filter(m => m.role === 'interviewer').slice(-1)[0]?.content || '',
          answerText: lastAnswer,
          feedbackJson: JSON.stringify(parsed),
        }).then(() => onExchangeSaved())
      }

      if (parsed.sessionComplete || !parsed.nextQuestion) {
        setIsComplete(true)
        window.api.interviewUpdateSession(session.id, { status: 'completed' })
        onSessionUpdate({ ...session, status: 'completed' })
        window.dispatchEvent(new CustomEvent('interview-session-changed'))
      } else {
        setQuestionNumber(n => n + 1)
      }
    })

    const unError = window.api.onInterviewStreamError((err: string) => {
      toast('error', `Interview error: ${err}`)
      setIsStreaming(false)
      setWaitingForParse(false)
    })

    cleanupRef.current = [unToken, unDone, unError]

    window.api.interviewSendChat({
      sessionId: session.id,
      model,
      provider,
      systemPrompt: buildSystemPrompt(),
      messages: apiMessages,
    })
  }, [session, exchanges, job, brief, settings, model, provider])

  async function handleSubmit() {
    if (!answer.trim() || isStreaming) return
    const trimmed = answer.trim()
    setAnswer('')

    const userMessage: ChatMessage = { role: 'user', content: trimmed }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)

    await askNextQuestion(trimmed, newMessages)
  }

  async function handlePause() {
    await window.api.interviewUpdateSession(session.id, { status: 'paused' })
    onSessionUpdate({ ...session, status: 'paused' })
    window.dispatchEvent(new CustomEvent('interview-session-changed'))
    toast('success', 'Session paused. You can resume it from the Past Sessions panel.')
  }

  async function handleEndEarly() {
    const answerCount = exchanges.length + messages.filter(m => m.role === 'user').length
    const status = answerCount < MINI_DEBRIEF_THRESHOLD ? 'completed_early' : 'completed'
    await window.api.interviewUpdateSession(session.id, { status: 'completed' })
    onSessionUpdate({ ...session, status: 'completed' })
    setIsComplete(true)
    setConfirmEnd(false)
    window.dispatchEvent(new CustomEvent('interview-session-changed'))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-accent" />
          <span className="text-xs font-semibold text-text">Live Feedback</span>
          {!isComplete && (
            <span className="text-xs text-text-dim">— Question {questionNumber}</span>
          )}
          {isComplete && (
            <span className="badge badge-success text-[10px]">Complete</span>
          )}
        </div>
        {!isComplete && (
          <div className="flex gap-2">
            <button onClick={handlePause} className="btn-ghost text-xs flex items-center gap-1">
              <Pause size={12} />Pause
            </button>
            {confirmEnd ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-dim">End session?</span>
                <button onClick={handleEndEarly} className="btn-danger text-xs">End & Debrief</button>
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

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => {
          if (msg.role === 'interviewer') {
            return (
              <div key={i} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-accent">I</span>
                </div>
                <div className="flex-1 bg-surface-2 rounded-lg px-3 py-2.5 max-w-[85%]">
                  <p className="text-sm text-text leading-relaxed">{msg.content}</p>
                </div>
              </div>
            )
          }
          if (msg.role === 'user') {
            return (
              <div key={i} className="flex gap-3 justify-end">
                <div className="flex-1 bg-accent/10 border border-accent/20 rounded-lg px-3 py-2.5 max-w-[85%]">
                  <p className="text-sm text-text leading-relaxed">{msg.content}</p>
                </div>
                <div className="w-6 h-6 rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-text-dim">Y</span>
                </div>
              </div>
            )
          }
          if (msg.role === 'feedback' && msg.feedback) {
            return (
              <div key={i} className="pl-9">
                <FeedbackCard feedback={msg.feedback} isQuestionsSection={msg.isQuestionsSection ?? false} />
              </div>
            )
          }
          return null
        })}

        {/* Streaming indicator */}
        {(isStreaming || waitingForParse) && (
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-[10px] font-bold text-accent">I</span>
            </div>
            <div className="flex-1 bg-surface-2 rounded-lg px-3 py-2.5 max-w-[85%]">
              {isStreaming ? (
                <div className="flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin text-accent" />
                  <span className="text-xs text-text-dim">Thinking...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin text-accent" />
                  <span className="text-xs text-text-dim">Processing response...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {isComplete && (
          <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/20 rounded-lg">
            <CheckCircle size={14} className="text-success" />
            <p className="text-sm text-success font-medium">Session complete! Great work.</p>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* Input area */}
      {!isComplete && (
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
              placeholder="Type your answer... (Enter to submit, Shift+Enter for new line)"
              disabled={isStreaming || waitingForParse}
              className="flex-1 input resize-none text-sm"
              rows={3}
            />
            <button
              onClick={handleSubmit}
              disabled={!answer.trim() || isStreaming || waitingForParse}
              className="btn-primary flex-shrink-0 self-end"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
