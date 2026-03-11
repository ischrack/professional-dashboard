import React from 'react'
import { X, ArrowRight, MessageSquare, Code2, CheckSquare, Lightbulb, Wifi, BookOpen } from 'lucide-react'

interface CodeLearningHelpProps {
  onClose: () => void
}

export default function CodeLearningHelp({ onClose }: CodeLearningHelpProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface rounded-xl border border-border w-[680px] max-h-[85vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <BookOpen size={16} className="text-accent" />
            <h2 className="text-base font-semibold text-text">Code Learning — How It Works</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">

          {/* Overview */}
          <section className="space-y-2">
            <p className="text-sm text-text leading-relaxed">
              Code Learning generates a personalized, project-based coding curriculum and coaches you through it step by step.
              Describe what you want to build, pick your languages and experience level, and the module produces a tailored
              project proposal and full curriculum. A coaching chat answers questions without handing you the answer, and a
              code review feature gives structured feedback on your actual code.
            </p>
          </section>

          {/* Workflow */}
          <section>
            <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3">Workflow</h3>
            <div className="space-y-2.5">
              {[
                { step: '1', label: 'Describe your goal', detail: 'Fill in the intake form — what you want to build, which languages, your experience level, and how much time you have. "Surprise me" picks a random bioinformatics project idea.' },
                { step: '2', label: 'Review the proposal', detail: 'The LLM generates a specific, resume-worthy project with a title, learning objectives, and estimated steps. Regenerate as many times as you like, or edit the details and regenerate.' },
                { step: '3', label: 'Accept and stream the curriculum', detail: 'Click "Start Project" and watch the step titles stream in as the full curriculum generates. Each step includes context, precise instructions, progressive hints, and a validation checklist.' },
                { step: '4', label: 'Work through the steps', detail: 'Open the scaffolded project folder in VS Code. Read the step context, follow the instructions, reveal hints if needed, ask the coach, and request code review when ready.' },
                { step: '5', label: 'Mark steps complete', detail: 'Click "Mark Step Complete" in the dashboard or use the VS Code extension command. The next step unlocks automatically.' },
              ].map(({ step, label, detail }) => (
                <div key={step} className="flex gap-3">
                  <div className="w-5 h-5 rounded-full bg-accent/20 text-accent text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {step}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text">{label}</p>
                    <p className="text-xs text-text-dim mt-0.5 leading-relaxed">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* VS Code extension */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Wifi size={13} className="text-accent" />
              <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">VS Code Extension</h3>
            </div>
            <p className="text-xs text-text-dim leading-relaxed mb-3">
              The companion extension connects VS Code to the running dashboard. It shows your current step in the status bar,
              lets you mark steps complete and trigger code review from inside the editor, and optionally sends your file for
              review on every save.
            </p>
            <div className="bg-surface-2 rounded-lg p-4 space-y-3">
              <p className="text-xs font-semibold text-text-muted">One-time install (from the repo root):</p>
              <div className="font-mono text-xs text-text-muted bg-surface rounded px-3 py-2 space-y-1">
                <p>cd vscode-extension</p>
                <p>npm install &amp;&amp; npm run compile &amp;&amp; npx vsce package</p>
                <p>code --install-extension professional-dashboard-code-learning-0.1.0.vsix</p>
              </div>
              <p className="text-xs text-text-dim">
                The extension activates automatically when you open a folder containing a{' '}
                <code className="bg-surface rounded px-1 text-text-muted">.professional-dashboard-project</code>{' '}
                marker file — created when you scaffold a project from the dashboard.
                The status bar shows <strong className="text-text-muted">$(mortar-board) Connected</strong> when the link is active.
              </p>
              <div className="space-y-1 pt-1">
                <p className="text-xs font-semibold text-text-muted">Extension commands (Command Palette or status bar click):</p>
                {[
                  ['Mark Step Complete', 'Marks the active step done and advances to the next'],
                  ['Review This File', 'Sends the active editor file to the dashboard for LLM code review'],
                  ['Open Dashboard', 'Brings the Professional Dashboard app to focus'],
                ].map(([cmd, desc]) => (
                  <div key={cmd} className="flex gap-2 text-xs">
                    <ArrowRight size={11} className="text-accent flex-shrink-0 mt-0.5" />
                    <span>
                      <span className="text-text-muted font-medium">Code Learning: {cmd}</span>
                      <span className="text-text-dim"> — {desc}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Coaching chat */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare size={13} className="text-accent" />
              <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Coaching Chat</h3>
            </div>
            <p className="text-xs text-text-dim leading-relaxed">
              Ask questions, paste error messages, or describe where you are stuck. The coach explains concepts,
              describes what you need to build, and gives feedback on what you have written — but never provides
              complete, working code unless you have made multiple genuine attempts and are genuinely stuck.
              When explaining concepts, the coach anchors them to biology where possible.
            </p>
            <p className="text-xs text-text-dim mt-2">
              Use <kbd className="bg-surface-2 border border-border rounded px-1.5 py-0.5 text-[10px] text-text-muted">⌘↵</kbd> or{' '}
              <kbd className="bg-surface-2 border border-border rounded px-1.5 py-0.5 text-[10px] text-text-muted">Ctrl↵</kbd> to send.
              Chat history is saved per step and restored when you reopen the app.
            </p>
          </section>

          {/* Code review */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Code2 size={13} className="text-accent" />
              <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Code Review</h3>
            </div>
            <p className="text-xs text-text-dim leading-relaxed">
              Click <strong className="text-text-muted">Review My Code</strong> to send your current file to the LLM for structured feedback.
              The review covers strengths, blocking issues, minor issues, style notes, and a specific next-steps nudge.
              Feedback never includes corrected code — only descriptions and hints pointing you toward the fix.
            </p>
            <p className="text-xs text-text-dim mt-2">
              Requires the VS Code extension to be connected — it reads the target file directly from your workspace.
              The connection indicator in the top-right of the Project Overview panel shows{' '}
              <Wifi size={10} className="inline text-success" /> when active.
            </p>
          </section>

          {/* Hints */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb size={13} className="text-accent" />
              <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Hints</h3>
            </div>
            <p className="text-xs text-text-dim leading-relaxed">
              Each step has 3–5 progressive hints. Each hint is narrower than the last — the first might point you to
              the right documentation section, the last might describe the exact structure you need without giving
              working code. Reveal as many as you need. Hint counts are saved per step and persist across app restarts.
            </p>
          </section>

          {/* Step completion */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <CheckSquare size={13} className="text-accent" />
              <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Completing Steps</h3>
            </div>
            <p className="text-xs text-text-dim leading-relaxed">
              Mark a step complete when your code satisfies the validation criteria described in the step. You can do this
              from the dashboard ("Mark Step Complete" button) or from VS Code ("Code Learning: Mark Step Complete" command).
              Completed steps stay accessible — click any completed or active step in the right panel to review its context
              and chat history.
            </p>
          </section>

          {/* Tips */}
          <section className="border-t border-border pt-5">
            <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3">Tips</h3>
            <ul className="space-y-1.5">
              {[
                'The project folder and active step persist — close and reopen the app and you pick up exactly where you left off.',
                'Navigate freely between completed and active steps. Chat history is preserved per step and loaded lazily.',
                'Set a default project folder in Settings → Code Learning so new projects scaffold there without prompting.',
                'The "Review on save" setting in Settings → Code Learning sends your file automatically on every VS Code save. Disable it if you find it disruptive.',
                '"Surprise me" on the intake form picks a random bioinformatics project — useful when you want to practice but have no specific goal in mind.',
                'Start a new project at any time via the "+ New Project" button. Your previous project is archived in the database.',
              ].map((tip, i) => (
                <li key={i} className="flex gap-2 text-xs text-text-dim">
                  <span className="text-accent flex-shrink-0">—</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </section>

        </div>
      </div>
    </div>
  )
}
