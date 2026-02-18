import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Clock, CheckCircle, Pause, AlertTriangle, Trash2, FileText, MessageSquare } from 'lucide-react'
import clsx from 'clsx'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { InterviewSession, InterviewExchange, InterviewBrief, Job } from '@shared/types'
import { useToast } from '../../../shared/hooks/useToast'

interface SessionRowProps {
  session: InterviewSession
  currentBriefVersion: number | null
  job: Job
  onDelete: (id: number) => void
  onSaveNotes: (sessionId: number) => void
}

function SessionRow({ session, currentBriefVersion, job, onDelete, onSaveNotes }: SessionRowProps) {
  const [open, setOpen] = useState(false)
  const [exchanges, setExchanges] = useState<InterviewExchange[]>([])
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'debrief' | 'transcript'>('debrief')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isStale = session.briefVersion !== null && currentBriefVersion !== null && session.briefVersion < currentBriefVersion

  const statusIcon = {
    completed: <CheckCircle size={12} className="text-success" />,
    paused: <Pause size={12} className="text-warning" />,
    in_progress: <Clock size={12} className="text-accent" />,
  }[session.status]

  const statusLabel = {
    completed: 'Completed',
    paused: 'Paused',
    in_progress: 'In Progress',
  }[session.status]

  async function handleOpen() {
    if (!open && exchanges.length === 0) {
      setLoading(true)
      const exs = await window.api.interviewGetExchanges(session.id) as InterviewExchange[]
      setExchanges(exs)
      setLoading(false)
    }
    setOpen(o => !o)
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={handleOpen}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2 transition-colors text-left"
      >
        {open ? <ChevronDown size={14} className="text-text-dim flex-shrink-0" /> : <ChevronRight size={14} className="text-text-dim flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-text">
              {new Date(session.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <span className={clsx('badge text-[10px]', session.mode === 'live_feedback' ? 'badge-accent' : 'badge-gray')}>
              {session.mode === 'live_feedback' ? 'Live Feedback' : 'Full Run'}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-text-dim">
              {statusIcon}{statusLabel}
            </span>
          </div>
        </div>
        {isStale && (
          <div className="flex items-center gap-1 text-[10px] text-warning flex-shrink-0" title="Research brief was updated after this session">
            <AlertTriangle size={10} />Stale brief
          </div>
        )}
        {confirmDelete ? (
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <button onClick={() => onDelete(session.id)} className="btn-danger text-[10px] py-0.5 px-2">Delete</button>
            <button onClick={() => setConfirmDelete(false)} className="btn-ghost text-[10px] py-0.5 px-2">Cancel</button>
          </div>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
            className="p-1 text-text-dim hover:text-error transition-colors flex-shrink-0"
            title="Delete session"
          >
            <Trash2 size={12} />
          </button>
        )}
      </button>

      {open && (
        <div className="border-t border-border">
          {loading && (
            <div className="p-4 text-center text-xs text-text-dim">Loading...</div>
          )}
          {!loading && (
            <>
              {isStale && (
                <div className="mx-3 mt-3 p-2 bg-warning/10 border border-warning/30 rounded flex items-start gap-2">
                  <AlertTriangle size={12} className="text-warning flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-warning">The research brief was updated after this session was conducted.</p>
                </div>
              )}

              {/* Tab switcher for Full Run completed sessions */}
              {session.mode === 'full_run' && session.status === 'completed' && session.debriefText && (
                <div className="flex gap-1 px-3 pt-3">
                  <div className="flex bg-surface-2 rounded-md p-0.5">
                    <button
                      onClick={() => setViewMode('debrief')}
                      className={clsx('px-2 py-1 rounded text-xs transition-colors flex items-center gap-1', viewMode === 'debrief' ? 'bg-surface text-text' : 'text-text-dim hover:text-text')}
                    >
                      <FileText size={11} />Debrief
                    </button>
                    <button
                      onClick={() => setViewMode('transcript')}
                      className={clsx('px-2 py-1 rounded text-xs transition-colors flex items-center gap-1', viewMode === 'transcript' ? 'bg-surface text-text' : 'text-text-dim hover:text-text')}
                    >
                      <MessageSquare size={11} />Transcript
                    </button>
                  </div>
                </div>
              )}

              {/* Debrief for Full Run */}
              {session.mode === 'full_run' && viewMode === 'debrief' && session.debriefText && (
                <div className="p-3">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h2: ({ children }) => <h2 className="text-sm font-semibold text-text mt-3 mb-1.5 first:mt-0">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mt-2 mb-1">{children}</h3>,
                      p: ({ children }) => <p className="text-xs text-text-muted leading-relaxed mb-1.5">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc list-outside ml-4 space-y-0.5 mb-1.5">{children}</ul>,
                      li: ({ children }) => <li className="text-xs text-text-muted leading-relaxed">{children}</li>,
                      strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
                    }}
                  >
                    {session.debriefText}
                  </ReactMarkdown>
                </div>
              )}

              {/* Transcript view */}
              {(session.mode === 'live_feedback' || viewMode === 'transcript') && (
                <div className="p-3 space-y-3">
                  {exchanges.length === 0 ? (
                    <p className="text-xs text-text-dim text-center py-4">No exchanges recorded for this session.</p>
                  ) : (
                    exchanges.map(ex => (
                      <div key={ex.id} className="space-y-2">
                        <div className="bg-surface-2 rounded-lg px-3 py-2">
                          <p className="text-[10px] font-semibold text-text-dim uppercase mb-1">Q{ex.sequence + 1}</p>
                          <p className="text-xs text-text leading-relaxed">{ex.questionText}</p>
                        </div>
                        {ex.answerText && (
                          <div className="ml-4 bg-accent/5 border border-accent/20 rounded-lg px-3 py-2">
                            <p className="text-[10px] font-semibold text-accent uppercase mb-1">Answer</p>
                            <p className="text-xs text-text-muted leading-relaxed">{ex.answerText}</p>
                          </div>
                        )}
                        {session.mode === 'live_feedback' && ex.feedbackJson && (() => {
                          try {
                            const parsed = JSON.parse(ex.feedbackJson)
                            if (!parsed.feedback) return null
                            return (
                              <div className="ml-4 bg-surface-2 border border-border rounded-lg px-3 py-2 space-y-1.5">
                                <p className="text-[10px] font-semibold text-text-dim uppercase">Feedback</p>
                                <p className="text-xs text-success leading-relaxed"><span className="font-semibold">+</span> {parsed.feedback.strength}</p>
                                <p className="text-xs text-warning leading-relaxed"><span className="font-semibold">↑</span> {parsed.feedback.improvement}</p>
                                {parsed.feedback.suggestedRefinement && (
                                  <p className="text-xs text-text-dim leading-relaxed italic">{parsed.feedback.suggestedRefinement}</p>
                                )}
                              </div>
                            )
                          } catch { return null }
                        })()}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Save Key Takeaways */}
              {session.status === 'completed' && (
                <div className="px-3 pb-3 border-t border-border pt-3">
                  <button
                    onClick={() => onSaveNotes(session.id)}
                    className="btn-ghost text-xs flex items-center gap-1.5"
                  >
                    <FileText size={12} />Save Key Takeaways to Notes
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface PastSessionsProps {
  sessions: InterviewSession[]
  currentBriefVersion: number | null
  job: Job
  onDelete: (id: number) => void
  onSessionsRefresh: () => void
}

export default function PastSessions({ sessions, currentBriefVersion, job, onDelete, onSessionsRefresh }: PastSessionsProps) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [saveNotesPreview, setSaveNotesPreview] = useState<{ sessionId: number; text: string } | null>(null)

  async function handleSaveNotes(sessionId: number) {
    // Build preview text from session
    const session = sessions.find(s => s.id === sessionId)
    if (!session) return

    let previewText = ''
    if (session.mode === 'full_run' && session.debriefText) {
      // Summarize the debrief key points
      previewText = session.debriefText.slice(0, 800) + (session.debriefText.length > 800 ? '...' : '')
    } else {
      previewText = `Mock Interview — ${session.mode === 'live_feedback' ? 'Live Feedback' : 'Full Run'} session completed on ${new Date(session.updatedAt).toLocaleDateString()}.`
    }

    setSaveNotesPreview({ sessionId, text: previewText })
  }

  async function confirmSaveNotes() {
    if (!saveNotesPreview) return
    await window.api.interviewAppendNotes(job.id, saveNotesPreview.text)
    setSaveNotesPreview(null)
    toast('success', 'Key takeaways saved to Notes')
  }

  if (sessions.length === 0) return null

  return (
    <>
      <div className="border-t border-border">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-2 transition-colors"
        >
          <span className="text-xs font-semibold text-text-dim uppercase tracking-wider">
            Past Sessions ({sessions.length})
          </span>
          {open ? <ChevronDown size={14} className="text-text-dim" /> : <ChevronRight size={14} className="text-text-dim" />}
        </button>

        {open && (
          <div className="px-4 pb-4 space-y-2">
            {sessions.map(s => (
              <SessionRow
                key={s.id}
                session={s}
                currentBriefVersion={currentBriefVersion}
                job={job}
                onDelete={onDelete}
                onSaveNotes={handleSaveNotes}
              />
            ))}
          </div>
        )}
      </div>

      {/* Save Notes Preview Dialog */}
      {saveNotesPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface rounded-xl border border-border w-[500px] max-h-[60vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-border">
              <h3 className="text-sm font-semibold text-text">Save Key Takeaways to Notes</h3>
              <p className="text-xs text-text-dim mt-1">The following will be appended to this job's Notes tab:</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="bg-surface-2 rounded-lg p-3">
                <p className="text-xs text-text-muted whitespace-pre-wrap">{saveNotesPreview.text}</p>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-border">
              <button onClick={confirmSaveNotes} className="btn-primary">Save to Notes</button>
              <button onClick={() => setSaveNotesPreview(null)} className="btn-ghost">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
