# Professional Dashboard

A desktop app for biomedical scientists managing job searches, scientific content, and interview preparation. Built with Electron, React, TypeScript, and Tailwind v4.

---

## Features

### Job Search
Add and manage job listings manually or via LinkedIn alert emails (IMAP). Enrich jobs with full descriptions, salary, and applicant data by scraping the LinkedIn posting. Track application status through the full pipeline.

### Application Workspace
Per-job workspace with tabbed editing for:
- **Resume** — Tailored resume generated from your base resume and the job description
- **Cover Letter** — Job-specific cover letter
- **Recruiter Message** — Cold outreach message
- **Q&A** — Generate and store answers to application questions; save templates across jobs
- **Notes** — Free-form notes for each job
- **Interview Prep** — Research brief and mock interview (see below)

### Interview Prep
Two-phase interview preparation scoped to each job.

**Phase 1 — Research Brief**: LLM-powered web research on the company, role, competitive landscape, pipeline, and interview intelligence. Choose Quick Brief (~2 min) or Deep Research (~5–10 min). Results are saved per job and displayed as a collapsible structured report. A sidebar shortcut gives one-click access to the most recently viewed job's prep.

**Phase 2 — Mock Interview**: Interactive mock interview in two modes:
- **Live Feedback** — Question → your answer → structured feedback (Strength / Improvement / Suggested refinement) → next question. Feedback animates in section by section.
- **Full Run** — All questions without interruption, followed by a full debrief with per-question notes, top priority areas, and suggested rewrites. Completed sessions show a Debrief / Transcript tab switcher.

Sessions auto-save after every exchange. Paused sessions can be resumed. A "Save Key Takeaways to Notes" button appends a summary to the job's Notes tab.

### Code Learning

Project-based coding curriculum generator and step-by-step coach for biomedical scientists learning to write production-quality bioinformatics code.

**How it works:**

1. **Intake** — Describe what you want to build, pick your languages (Python, R, Nextflow, Snakemake, SQL, Bash, Airflow, or Mixed), set your experience level and available time. "Surprise me" picks a random bioinformatics project.
2. **Proposal** — The LLM generates a specific, resume-worthy project proposal with a title, summary, learning objectives, prerequisite installs, and estimated step count. Regenerate as many times as you like.
3. **Curriculum generation** — Accept the proposal and watch step titles stream in as the full curriculum generates. Each step includes 2–4 paragraphs of concept context, precise instructions, 3–5 progressive hints, a target file, and validation criteria.
4. **Active project** — Work through steps in VS Code. Reveal hints, ask the coaching chat, and request code review when ready. Mark steps complete manually or via the VS Code extension.

**Coaching chat** answers questions, explains concepts (anchored to biology where possible), and gives feedback on your code — but never provides complete working solutions unless you are genuinely stuck after multiple attempts.

**Code review** sends your current file to the LLM for structured feedback: strengths, blocking issues, minor issues, style notes, and a specific next-steps nudge. Requires the VS Code extension to be connected.

Progress, chat history, and hint counts are persisted in SQLite and restored on app restart.

#### VS Code Extension

The companion extension connects VS Code to the running dashboard app over a local WebSocket. It activates automatically when you open a folder containing a `.professional-dashboard-project` marker file (created when you scaffold a project from the dashboard).

**One-time install:**

```bash
cd vscode-extension
npm install && npm run compile && npx vsce package
code --install-extension professional-dashboard-code-learning-0.1.0.vsix
```

**What it provides:**
- Status bar: `$(mortar-board) Connected` / `Disconnected` — click to open a command menu
- `Code Learning: Mark Step Complete` — marks the active step done and advances to the next
- `Code Learning: Review This File` — sends the active editor file to the dashboard for LLM code review
- `Code Learning: Open Dashboard` — brings the Professional Dashboard app to focus
- Optional: `codeLearning.reviewOnSave` setting sends the file for review on every save (off by default)

The extension reads `~/.professional-dashboard/ws-port` to find the dashboard's WebSocket port and reconnects automatically with exponential backoff if the connection is lost.

See [`vscode-extension/README.md`](vscode-extension/README.md) for full build and install instructions.

### Post Generator
Generate LinkedIn posts from scientific papers, articles, or raw text. Iterative chat-based revision workflow. Supports PDF upload and URL ingestion.

### Paper Discovery
Search PubMed using saved profiles (keywords, MeSH terms, authors, journals). Manage a personal paper library with starring, read status, and PDF linking.

### Application Tracker
Status board for all applied jobs. Tracks progression from No Response through Offer / Rejected.

---

## Setup

### Requirements
- Node.js 18+
- macOS (primary target)

### Install
```bash
npm install
```

### API Keys
Configure in **Settings → API Keys**. Keys are encrypted at rest using Electron's OS-level `safeStorage`.

| Key | Used for |
|-----|----------|
| Anthropic Claude | All LLM features (research, resume, cover letter, Q&A, mock interview) |
| OpenAI | Optional alternative model provider |
| PubMed / NCBI | Paper Discovery (optional — increases rate limits) |

---

## Running

| Command | What it does | When to use |
|---------|-------------|-------------|
| `npm run dev` | Starts the app with hot reload via electron-vite | Everyday development |
| `npm run build` | Compiles everything to `out/` but does not package | Verifying a production build works |
| `npm run rebuild` | Recompiles the better-sqlite3 native module for the current Electron version | After any Electron version upgrade |
| `npm run dist` | Runs `build` then packages into a `.dmg` installer via electron-builder | Creating a distributable release |

For day-to-day use, `npm run dev` is all you need. `npm run rebuild` is not for running the app — it only recompiles the native SQLite binding and is only required when the Electron version changes.

---

## Architecture

| Layer | Stack |
|-------|-------|
| Shell | Electron 40 |
| Frontend | React 19, TypeScript, Tailwind v4 |
| Build | electron-vite, Vite 7 |
| Database | better-sqlite3 (SQLite, WAL mode) |
| LLM | Anthropic SDK, OpenAI SDK |
| Rich text | Tiptap 3 |
| Markdown render | react-markdown + remark-gfm |
| DOCX export | docx |

### Process model
```
Main process (Node)         Renderer process (React)        VS Code Extension
├── db/                     ├── modules/                    ├── extension.ts
│   ├── index.ts            │   ├── JobSearch/              │   (WebSocket client)
│   └── schema.ts           │   │   ├── ApplicationWorkspace│   ↕ ws://localhost:52049+
├── ipc/                    │   │   └── interview/          └── ~/.professional-dashboard/
│   ├── jobs.ts             │   ├── PostGenerator/              ├── ws-port
│   ├── interview.ts        │   ├── PaperDiscovery/             └── active-projects.json
│   ├── codeLearning.ts     │   ├── CodeLearning/
│   ├── llm.ts              │   └── ApplicationTracker/
│   ├── settings.ts         └── settings/
│   └── ...                     └── SettingsPanel.tsx
├── wsServer.ts
└── index.ts
```

All main ↔ renderer communication goes through the typed IPC bridge in `src/preload/index.ts`, exposed as `window.api`.

### Streaming IPC
Long-running operations (research generation, mock interview chat) use a fire-and-forget `send` + listener pattern so the main process can push tokens back incrementally:

```
renderer                           main
   │──send('interview:start-research')──►│
   │◄──on('interview:search-event')──────│  per web search
   │◄──on('interview:token')─────────────│  repeated
   │◄──on('interview:research-done')─────│  final result
```

### Database
SQLite at `~/Library/Application Support/professional-dashboard/dashboard.db`.
Configurable to iCloud Drive / Dropbox via **Settings → Storage** (restart required; do not open on multiple machines simultaneously).

Schema: `jobs`, `application_materials`, `qa_entries`, `interview_briefs`, `interview_sessions`, `interview_exchanges`, `job_notes`, `resume_bases`, `post_sessions`, `papers`, `search_profiles`, `code_learning_projects`, `code_learning_steps`, `code_learning_messages`.

---

## Settings Reference

| Section | Setting | Description |
|---------|---------|-------------|
| API Keys | Anthropic / OpenAI / PubMed | Encrypted key storage |
| Models | Per-module model | Model for post, paper, resume, cover letter, Q&A generation |
| Models | Code Learning Coach | Model for proposals, curriculum, coaching chat, and code review (default: claude-opus-4-6) |
| Interview Prep | Research model | Model for web research (use most capable available) |
| Interview Prep | Default research depth | Quick / Deep / Always ask |
| Code Learning | Default project folder | Where new projects are scaffolded (default: ~/Projects) |
| Code Learning | Review on save | Auto-send active file for LLM review on every VS Code save (off by default — can be disruptive) |
| Code Learning | Ollama endpoint | Local model support (coming soon) |
| Code Learning | VS Code extension | Connection status indicator and install command |
| Resume Bases | Named resumes | Master resumes used as generation context |
| Storage | Output folder | Where exported DOCX files are saved |
| Storage | Database location | Relocate DB for cloud sync |
| Email / IMAP | IMAP credentials | LinkedIn job alert email ingestion |

---

## Notes

- **better-sqlite3** is a native module — run `npm run rebuild` after any Electron version upgrade.
- LinkedIn enrichment uses an embedded `WebContentsView` with a separate browser partition (`persist:linkedin`). You may need to log in once on first use.
- PDF export for the research brief is scaffolded (the export button exists) but requires a Puppeteer or jsPDF integration to render to file.
- Q&A templates created before the Interview Prep feature was added have `category = null` and are always injected into mock interview sessions as a catch-all.
