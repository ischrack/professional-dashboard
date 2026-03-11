import React, { useState, useRef, useEffect } from 'react'
import { Send, Code2, Bot, User, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import type { FeedbackResponse } from '@shared/types'
import FeedbackCard from './FeedbackCard'

// ── Message type ─────────────────────────────────────────────────────────────

export type CoachMessage =
  | { id: string; role: 'user' | 'assistant'; content: string }
  | { id: string; role: 'feedback'; feedback: FeedbackResponse }

// ── Component ────────────────────────────────────────────────────────────────

interface CoachingChatProps {
  stepId: string
  messages: CoachMessage[]
  isReviewing?: boolean
  isCoaching?: boolean
  onSendMessage: (text: string) => void
  onReviewCode: () => void
  onRequestReview?: () => void
}

export default function CoachingChat({
  stepId,
  messages,
  isReviewing = false,
  isCoaching = false,
  onSendMessage,
  onReviewCode,
  onRequestReview,
}: CoachingChatProps) {
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Clear input when step changes
  useEffect(() => {
    setInput('')
  }, [stepId])

  function handleSend() {
    const text = input.trim()
    if (!text) return
    onSendMessage(text)
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <p className="text-xs font-semibold text-text-dim uppercase tracking-wider">
          Coaching Chat
        </p>
        <button
          onClick={onReviewCode}
          disabled={isReviewing}
          className="btn-secondary text-xs"
          title="Send current file contents for LLM review (requires VS Code extension)"
        >
          {isReviewing
            ? <><Loader2 size={12} className="animate-spin" />Reviewing…</>
            : <><Code2 size={12} />Review My Code</>
          }
        </button>
      </div>

      {/* Messages */}
      <div className="flex flex-col gap-3 px-5 py-4">
        {messages.length === 0 && (
          <p className="text-sm text-text-dim text-center py-6">
            Ask me anything about this step.
          </p>
        )}

        {messages.map(msg => {
          // Feedback cards render inline as a full-width card
          if (msg.role === 'feedback') {
            return (
              <div key={msg.id} className="w-full">
                <FeedbackCard
                  response={msg.feedback}
                  onRequestReview={onRequestReview ?? onReviewCode}
                />
              </div>
            )
          }

          // Regular user / assistant bubbles
          return (
            <div
              key={msg.id}
              className={clsx(
                'flex gap-2.5',
                msg.role === 'user' ? 'flex-row-reverse' : 'flex-row',
              )}
            >
              {/* Avatar */}
              <div className={clsx(
                'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                msg.role === 'user' ? 'bg-accent/20' : 'bg-surface-3',
              )}>
                {msg.role === 'user'
                  ? <User size={11} className="text-accent" />
                  : <Bot size={11} className="text-text-dim" />
                }
              </div>

              {/* Bubble */}
              <div className={clsx(
                'max-w-[80%] px-3 py-2 rounded-lg text-sm leading-relaxed',
                msg.role === 'user'
                  ? 'bg-accent/15 text-text rounded-tr-sm'
                  : 'bg-surface-2 text-text-muted rounded-tl-sm',
              )}>
                {msg.content}
              </div>
            </div>
          )
        })}

        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="px-5 pb-5 pt-1 border-t border-border">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question or paste an error message…"
            className="input resize-none flex-1 text-sm"
            rows={2}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isCoaching}
            className="btn-primary p-2.5 flex-shrink-0 self-end"
            title="Send (⌘↵ or Ctrl↵)"
          >
            {isCoaching ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        <p className="text-[10px] text-text-dim mt-1.5">⌘↵ or Ctrl↵ to send</p>
      </div>

    </div>
  )
}
