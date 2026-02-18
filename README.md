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
Main process (Node)         Renderer process (React)
├── db/                     ├── modules/
│   ├── index.ts            │   ├── JobSearch/
│   └── schema.ts           │   │   ├── ApplicationWorkspace.tsx
├── ipc/                    │   │   └── interview/
│   ├── jobs.ts             │   ├── PostGenerator/
│   ├── interview.ts        │   ├── PaperDiscovery/
│   ├── llm.ts              │   └── ApplicationTracker/
│   ├── settings.ts         └── settings/
│   └── ...                     └── SettingsPanel.tsx
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

Schema: `jobs`, `application_materials`, `qa_entries`, `interview_briefs`, `interview_sessions`, `interview_exchanges`, `job_notes`, `resume_bases`, `post_sessions`, `papers`, `search_profiles`.

---

## Settings Reference

| Section | Setting | Description |
|---------|---------|-------------|
| API Keys | Anthropic / OpenAI / PubMed | Encrypted key storage |
| Models | Per-module model | Model for post, paper, resume, cover letter, Q&A generation |
| Interview Prep | Research model | Model for web research (use most capable available) |
| Interview Prep | Default research depth | Quick / Deep / Always ask |
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
