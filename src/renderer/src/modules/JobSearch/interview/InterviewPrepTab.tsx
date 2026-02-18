import React, { useState, useEffect } from 'react'
import { Play, AlertCircle, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import type { Job, InterviewBrief, InterviewSession, InterviewExchange, InterviewMode, InterviewCategory } from '@shared/types'
import ResearchBrief from './ResearchBrief'
import SessionSetup from './SessionSetup'
import LiveFeedbackSession from './LiveFeedbackSession'
import FullRunSession from './FullRunSession'
import PastSessions from './PastSessions'
import { useToast } from '../../../shared/hooks/useToast'

type MainView = 'brief' | 'session_setup' | 'session'

interface InterviewPrepTabProps {
  job: Job
}

export default function InterviewPrepTab({ job }: InterviewPrepTabProps) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [brief, setBrief] = useState<InterviewBrief | null>(null)
  const [sessions, setSessions] = useState<InterviewSession[]>([])
  const [activeSession, setActiveSession] = useState<InterviewSession | null>(null)
  const [activeExchanges, setActiveExchanges] = useState<InterviewExchange[]>([])
  const [view, setView] = useState<MainView>('brief')
  const [loading, setLoading] = useState(true)

  // Notify sidebar about session changes
  useEffect(() => {
    localStorage.setItem('lastInterviewPrepJobId', String(job.id))
    window.dispatchEvent(new CustomEvent('interview-nav-changed'))
  }, [job.id])

  useEffect(() => {
    loadData()
  }, [job.id])

  async function loadData() {
    setLoading(true)
    const [s, b, sess] = await Promise.all([
      window.api.getSettings(),
      window.api.interviewGetBrief(job.id),
      window.api.interviewGetSessions(job.id),
    ])
    setSettings(s as Record<string, unknown>)
    setBrief(b as InterviewBrief | null)
    const sessionList = sess as InterviewSession[]
    setSessions(sessionList)

    // Check for in-progress/paused sessions
    const active = sessionList.find(s => s.status === 'in_progress' || s.status === 'paused')
    if (active) {
      const exchanges = await window.api.interviewGetExchanges(active.id) as InterviewExchange[]
      setActiveSession(active)
      setActiveExchanges(exchanges)
    }

    setLoading(false)
  }

  async function handleStartSession(mode: InterviewMode, categories: InterviewCategory[]) {
    const sessionId = await window.api.interviewCreateSession({
      jobId: job.id,
      mode,
      categories,
    }) as number
    const newSession = await window.api.interviewGetSession(sessionId) as InterviewSession
    setActiveSession(newSession)
    setActiveExchanges([])
    setView('session')
    window.dispatchEvent(new CustomEvent('interview-session-changed'))
  }

  async function handleResumeSession() {
    if (!activeSession) return
    setView('session')
  }

  async function handleNewSessionClick() {
    setActiveSession(null)
    setView('session_setup')
  }

  function handleSessionUpdate(updated: InterviewSession) {
    setActiveSession(updated)
    setSessions(prev => prev.map(s => s.id === updated.id ? updated : s))
    window.dispatchEvent(new CustomEvent('interview-session-changed'))
  }

  async function handleExchangeSaved() {
    if (!activeSession) return
    const exs = await window.api.interviewGetExchanges(activeSession.id) as InterviewExchange[]
    setActiveExchanges(exs)
  }

  async function handleDeleteSession(sessionId: number) {
    await window.api.interviewDeleteSession(sessionId)
    setSessions(prev => prev.filter(s => s.id !== sessionId))
    if (activeSession?.id === sessionId) {
      setActiveSession(null)
      setView('brief')
    }
    window.dispatchEvent(new CustomEvent('interview-session-changed'))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-accent" />
      </div>
    )
  }

  const pausedOrActive = sessions.find(s => s.status === 'in_progress' || s.status === 'paused')
  const pastCompleted = sessions.filter(s => s.status === 'completed')
  const allPast = sessions.filter(s => s.id !== activeSession?.id || s.status === 'completed')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* View switcher bar */}
      <div className="flex border-b border-border flex-shrink-0">
        <button
          onClick={() => setView('brief')}
          className={clsx('px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px', view === 'brief' ? 'text-accent border-accent' : 'text-text-dim border-transparent hover:text-text')}
        >
          Research Brief
        </button>
        <button
          onClick={() => view === 'session' ? undefined : (pausedOrActive ? handleResumeSession() : setView('session_setup'))}
          className={clsx('px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5', view === 'session' || view === 'session_setup' ? 'text-accent border-accent' : 'text-text-dim border-transparent hover:text-text')}
        >
          Mock Interview
          {pausedOrActive && pausedOrActive.status === 'paused' && (
            <span className="w-1.5 h-1.5 rounded-full bg-warning" title="Paused session" />
          )}
          {pausedOrActive && pausedOrActive.status === 'in_progress' && (
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" title="In progress" />
          )}
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {/* Research Brief view */}
        {view === 'brief' && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              <ResearchBrief
                job={job}
                brief={brief}
                onBriefReady={b => setBrief(b)}
                settings={settings}
              />
            </div>
          </div>
        )}

        {/* Mock Interview: setup or session */}
        {(view === 'session_setup' || view === 'session') && (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Resume card (if paused/active session exists and we're on setup) */}
            {view === 'session_setup' && pausedOrActive && (
              <div className="mx-4 mt-4 p-3 border border-accent/30 bg-accent/5 rounded-lg flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text">
                    {pausedOrActive.status === 'paused' ? 'Paused session' : 'Session in progress'}
                  </p>
                  <p className="text-xs text-text-dim mt-0.5">
                    {pausedOrActive.mode === 'live_feedback' ? 'Live Feedback' : 'Full Run'} · Started {new Date(pausedOrActive.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button onClick={handleResumeSession} className="btn-primary text-xs flex-shrink-0">
                  <Play size={12} />Resume
                </button>
              </div>
            )}

            {/* Session setup form */}
            {view === 'session_setup' && (
              <div className="flex-1 overflow-y-auto">
                <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-dim uppercase tracking-wider">Start New Session</span>
                </div>
                <SessionSetup hasBrief={!!brief} onBegin={handleStartSession} />
              </div>
            )}

            {/* Active session */}
            {view === 'session' && activeSession && (
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-hidden">
                  {activeSession.mode === 'live_feedback' ? (
                    <LiveFeedbackSession
                      key={activeSession.id}
                      session={activeSession}
                      exchanges={activeExchanges}
                      job={job}
                      brief={brief}
                      settings={settings}
                      onSessionUpdate={handleSessionUpdate}
                      onExchangeSaved={handleExchangeSaved}
                    />
                  ) : (
                    <FullRunSession
                      key={activeSession.id}
                      session={activeSession}
                      exchanges={activeExchanges}
                      job={job}
                      brief={brief}
                      settings={settings}
                      onSessionUpdate={handleSessionUpdate}
                      onExchangeSaved={handleExchangeSaved}
                    />
                  )}
                </div>

                {/* Start new session button (when current is complete/paused) */}
                {(activeSession.status === 'completed' || activeSession.status === 'paused') && (
                  <div className="px-4 pb-3 border-t border-border pt-3 flex-shrink-0">
                    <button onClick={handleNewSessionClick} className="btn-secondary text-xs">
                      Start New Session
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Past sessions */}
            {(view === 'session_setup' || (view === 'session' && activeSession?.status === 'completed')) && (
              <div className="flex-shrink-0">
                <PastSessions
                  sessions={allPast.filter(s => s.status === 'completed' || (s.id !== activeSession?.id))}
                  currentBriefVersion={brief?.briefVersion ?? null}
                  job={job}
                  onDelete={handleDeleteSession}
                  onSessionsRefresh={loadData}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
