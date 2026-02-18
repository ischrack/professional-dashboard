import React, { useState, useEffect } from 'react'
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import {
  FileText, BookOpen, Briefcase, BarChart2, Settings, ChevronLeft, ChevronRight, Mic2
} from 'lucide-react'
import { ToastProvider } from './shared/hooks/useToast'
import PostGenerator from './modules/PostGenerator/PostGenerator'
import PaperDiscovery from './modules/PaperDiscovery/PaperDiscovery'
import JobSearch from './modules/JobSearch/JobSearch'
import ApplicationTracker from './modules/ApplicationTracker/ApplicationTracker'
import SettingsPanel from './settings/SettingsPanel'
import clsx from 'clsx'

const NAV_ITEMS = [
  { path: '/posts', icon: FileText, label: 'Post Generator' },
  { path: '/papers', icon: BookOpen, label: 'Paper Discovery' },
  { path: '/jobs', icon: Briefcase, label: 'Job Search' },
  { path: '/tracker', icon: BarChart2, label: 'Tracker' },
]

function Sidebar({ collapsed, onToggle, hasJobs }: { collapsed: boolean; onToggle: () => void; hasJobs: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [interviewBadge, setInterviewBadge] = useState(false)

  // Refresh badge when session changes or job changes
  useEffect(() => {
    async function checkBadge() {
      const lastId = localStorage.getItem('lastInterviewPrepJobId')
      if (!lastId) { setInterviewBadge(false); return }
      try {
        const result = await window.api.interviewHasActive(parseInt(lastId)) as { hasActive: boolean }
        setInterviewBadge(result.hasActive)
      } catch { setInterviewBadge(false) }
    }
    checkBadge()
    window.addEventListener('interview-session-changed', checkBadge)
    window.addEventListener('interview-nav-changed', checkBadge)
    return () => {
      window.removeEventListener('interview-session-changed', checkBadge)
      window.removeEventListener('interview-nav-changed', checkBadge)
    }
  }, [])

  const handleNavClick = (path: string, state?: Record<string, unknown>) => {
    navigate(path, state ? { state } : undefined)
  }

  function handleInterviewPrepClick() {
    const lastId = localStorage.getItem('lastInterviewPrepJobId')
    if (lastId) {
      navigate('/jobs', { state: { openJobId: parseInt(lastId), openTab: 'interview' } })
    } else {
      navigate('/jobs')
    }
  }

  return (
    <>
      <aside
        className={clsx(
          'flex flex-col bg-surface border-r border-border transition-all duration-200 flex-shrink-0',
          collapsed ? 'w-14' : 'w-52'
        )}
        style={{ height: '100vh' }}
      >
        {/* App title / logo area - macOS traffic light spacer */}
        <div className="titlebar-drag h-10 flex items-center justify-center flex-shrink-0">
          {!collapsed && (
            <span className="titlebar-no-drag text-xs font-semibold text-text-dim tracking-widest uppercase">
              Dashboard
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col gap-1 px-2 py-2 overflow-y-auto">
          {NAV_ITEMS.map(({ path, icon: Icon, label }) => {
            const active = location.pathname === path || (location.pathname === '/' && path === '/posts')
            return (
              <button
                key={path}
                onClick={() => handleNavClick(path)}
                title={collapsed ? label : undefined}
                className={clsx(
                  'flex items-center gap-3 px-2 py-2.5 rounded-md text-sm transition-colors w-full text-left',
                  active
                    ? 'bg-accent/15 text-accent font-medium'
                    : 'text-text-muted hover:text-text hover:bg-surface-2'
                )}
              >
                <Icon size={18} className="flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
              </button>
            )
          })}

          {/* Interview Prep shortcut — only shown when at least one job exists */}
          {hasJobs && (
            <button
              onClick={handleInterviewPrepClick}
              title={collapsed ? 'Interview Prep' : undefined}
              className={clsx(
                'flex items-center gap-3 px-2 py-2.5 rounded-md text-sm transition-colors w-full text-left relative',
                'text-text-muted hover:text-text hover:bg-surface-2'
              )}
            >
              <div className="relative flex-shrink-0">
                <Mic2 size={18} />
                {interviewBadge && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent" />
                )}
              </div>
              {!collapsed && <span>Interview Prep</span>}
            </button>
          )}
        </nav>

        {/* Bottom: Settings + collapse toggle */}
        <div className="flex flex-col gap-1 px-2 py-2 border-t border-border">
          <button
            onClick={() => setSettingsOpen(true)}
            title={collapsed ? 'Settings' : undefined}
            className="flex items-center gap-3 px-2 py-2.5 rounded-md text-sm text-text-muted hover:text-text hover:bg-surface-2 transition-colors w-full text-left"
          >
            <Settings size={18} className="flex-shrink-0" />
            {!collapsed && <span>Settings</span>}
          </button>
          <button
            onClick={onToggle}
            className="flex items-center justify-center p-1.5 rounded-md text-text-dim hover:text-text hover:bg-surface-2 transition-colors"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </aside>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </>
  )
}

function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [hasJobs, setHasJobs] = useState(false)

  useEffect(() => {
    async function checkJobs() {
      try {
        const jobs = await window.api.jobGetAll() as unknown[]
        setHasJobs(jobs.length > 0)
      } catch { /* ignore */ }
    }
    checkJobs()
    window.addEventListener('jobs-changed', checkJobs)
    return () => window.removeEventListener('jobs-changed', checkJobs)
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((c) => !c)} hasJobs={hasJobs} />
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<PostGenerator />} />
          <Route path="/posts" element={<PostGenerator />} />
          <Route path="/papers" element={<PaperDiscovery />} />
          <Route path="/jobs" element={<JobSearch />} />
          <Route path="/tracker" element={<ApplicationTracker />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    </ToastProvider>
  )
}
