# Professional Dashboard App — Claude Code Build Prompt

## Overview

Build a professional desktop dashboard application for a biomedical scientist. The app should be built with **Electron + React** (or **Tauri + React** if preferred for performance) with a local SQLite database for persistence. Use a clean, dark-themed UI inspired by Obsidian — high contrast, minimal chrome, keyboard-friendly. The app is organized into four major modules accessible via a persistent left sidebar: **Post Generator**, **Paper Discovery**, **Job Search**, and **Application Tracker**. All LLM interactions route through a configurable API layer (user provides their own API keys for Anthropic Claude and/or OpenAI). A global **Settings** panel allows API key management, model selection, and folder path configuration.

---

## Tech Stack

- **Frontend**: React + TypeScript, TailwindCSS (dark theme, Obsidian-inspired)
- **Backend/Runtime**: Electron (Node.js) or Tauri (Rust) for local file system access
- **Database**: SQLite via `better-sqlite3` (or Drizzle ORM) for jobs, paper metadata, application tracking
- **LLM API Layer**: Abstracted provider interface supporting Anthropic Claude API and OpenAI API — user selects model per module in Settings
- **Document Generation**: `docx` (via `docx` npm package) for Word files, `puppeteer` or `jsPDF` for PDF export
- **PDF Parsing**: `pdf-parse` or `pdfjs-dist` for ingesting uploaded manuscript PDFs
- **Web Scraping / Fetch**: `node-fetch` + `cheerio` for scraping article URLs and job postings
- **Email Parsing**: `imap` + `mailparser` npm packages for polling the dedicated job alert inbox
- **Embedded Browser**: Electron `BrowserView` / `WebContentsView` with an isolated browser partition for authenticated LinkedIn enrichment
- **Charts**: Recharts or Victory for the application tracker analytics

---

## Global Architecture

### Settings Panel
- **API Keys**: Secure local storage (encrypted via `electron-store` or OS keychain) for:
  - Anthropic Claude API key
  - OpenAI API key
  - PubMed/NCBI E-utilities API key
- **Job Alert Email (IMAP)**: Credentials for the dedicated job alert inbox (host, port, username, password, TLS toggle). Stored encrypted. Includes a "Test Connection" button.
- **LinkedIn Session**: Button to open the embedded browser panel for logging into LinkedIn. Session stored in an isolated Electron browser partition — completely separate from the user's main browser profile. "Log out" button to clear the session partition.
- **Model Selection**: Per-module dropdown (e.g., `claude-opus-4-6`, `gpt-4o`, etc.)
- **Default Output Folder**: File picker to set the root folder for saved resumes/cover letters
- **PubMed Search Terms**: Manage keyword lists, MeSH terms, and email digest preferences

### Sidebar Navigation
Four icons + labels for: Post Generator | Paper Discovery | Job Search | Application Tracker. Plus a Settings gear icon pinned to the bottom.

---

## Module 1: LinkedIn Science Post Generator

### Purpose
Generate LinkedIn posts about scientific literature following a strict house style, with iterative editing via an embedded rich text editor and LLM API back-and-forth.

### Input Panel (left ~40% of view)
- **Source input area** — accepts any combination of:
  - Paste a URL (article page, newsletter, preprint server like bioRxiv/medRxiv)
  - Upload a PDF (drag-and-drop zone)
  - Paste raw text / abstract directly
- **Fetch & Parse button**: On click, the app fetches/parses the source and displays a brief extracted summary (title, authors, journal, abstract) in a collapsible preview card for the user to confirm the right article was captured
- **User notes field**: Free-text box where the user can add their own interpretation, angle, or emphasis before generation ("Focus on the N2 polarization mechanism" / "Emphasize the clinical gap")
- **Generate Post button**

### LLM Prompt (system prompt baked in, not user-editable in UI):
Use the following LinkedIn Science Post Guidelines verbatim as the system prompt for this module:

```
LinkedIn Science Post Guidelines

Core Principles:
- Target length: 200–250 words
- Write for scientists, engineers, and biotech professionals who value precision and nuance
- Lead with mechanism and context, not hype
- Always acknowledge limitations and uncertainty
- End with a question that invites expert discussion, not agreement

Structure (4–5 paragraphs):
1. Opening (2–3 sentences): State the finding plainly and link it to broader context or a known problem.
2. Key findings (3–4 sentences): Summarize the experimental approach and main results.
3. Mechanism (2–4 sentences): Explain molecular/cellular/circuit-level detail. This is where scientific depth matters most.
4. Limitations & context (2–3 sentences): Note what remains unknown, model limitations, translational gaps, or complicating factors.
5. Closing question: Open-ended, reflecting on implications or adjacent questions. No yes/no questions.

Style rules:
- No em dashes, minimal bold/italics
- Avoid: "exciting," "groundbreaking," "game-changing," "revolutionary"
- Avoid: "sheds light on," "paves the way," "opens doors"
- Use precise technical terms without over-explaining
- Write like talking to a colleague, not lecturing a student
- Be conservative about clinical timelines and probability

Title: Outcome-focused ("How X does Y" / "Why X happens under Y conditions"). No clickbait.
Hashtags: 3–5 relevant field/method terms only.
Citation: Author et al., Journal Volume, Pages (Year). DOI only if particularly relevant.
When in doubt: Cut more than you think you need to. Trust the reader's expertise.
```

### Output / Editor Panel (right ~60% of view)
- **Rich text editor** (use `TipTap` or `Slate.js`) displaying the generated post
- User can directly edit text in the editor (click-to-type, select, delete — full inline editing)
- **Revision toolbar** above the editor:
  - Text input: "Request a revision..." (e.g., "Make the mechanism paragraph more specific" / "Shorten by 30 words")
  - **Send revision** button — appends the current editor content + user revision note to the conversation history and calls the LLM API; streams the response back into the editor
  - **Regenerate from scratch** button
  - **Undo / Redo** (native editor history)
- **Word count** displayed live, colored green if 200–250, yellow if close, red if outside range
- **Copy to clipboard** button (plain text, stripping any markdown)
- **Conversation history** collapsible sidebar: shows the full back-and-forth with the LLM for this session, like a chat thread, so the user can see what prompted each revision

### Conversation / Iteration Model
Maintain a conversation array in state for each post session. Each "Send revision" call appends:
1. `assistant` message = current post text in editor
2. `user` message = revision instruction

This allows multi-turn iteration with full context.

---

## Module 2: Paper Discovery Dashboard

### Purpose
Aggregate scientific literature from multiple sources into a single filterable, sortable dashboard.

### Data Sources
- **PubMed / NCBI E-utilities API** (primary): User configures keyword sets, MeSH terms, author names, and journals in Settings. App fetches new papers on a configurable schedule (daily/weekly) and stores metadata in SQLite.
- **bioRxiv/medRxiv RSS feeds**: Parse preprint feeds for configured keyword terms.
- **Manual add**: User can paste a DOI or PubMed ID to add a paper directly.
- *(Future / stretch goal)*: OpenAlex API for open-access metadata including citation counts and download metrics.

### Paper Card Display
Each paper shown as a card with:
- Title, authors (truncated), journal name, publication date
- Abstract (collapsed by default, expandable)
- Impact factor badge (sourced from a bundled journal IF lookup table — consider the SCImago or JIF dataset)
- "Trending" score badge — calculated from Altmetric score if available via Altmetric API (free tier), or from PubMed's Relative Citation Ratio (RCR) if accessible, or a simple proxy (citations in first 30 days via OpenAlex)
- Tags showing which keyword alert(s) triggered this paper
- Action buttons: **Open PDF**, **Open in Browser**, **Send to Post Generator** (pre-populates Module 1 with this paper), **Save / Star**

### Filters & Sorting (persistent filter bar at top)
- Date range picker
- Journal multi-select dropdown
- Impact factor range slider (e.g., 0–50+)
- Trending score sort
- Keyword/tag filter chips
- Read / Unread / Starred toggle
- Text search (searches title + abstract)

### Layout
Grid or list toggle. Default: list with compact cards. Pagination or infinite scroll.

---

## Module 3: Job Search & Application Workspace

### Purpose
Aggregate job postings, generate tailored application materials (resume, cover letter, recruiter message), and provide an editable workspace for each application.

### 3A. Job Postings Aggregator

**Data ingestion — three complementary paths:**

**Path 1 (Primary): IMAP Email Parsing**
The user sets up a dedicated email address (e.g., a Gmail alias or forwarding rule) that receives LinkedIn job alert emails. In Settings, configure IMAP credentials for this inbox. The app polls the inbox on a configurable schedule (e.g., every 30 minutes or on app launch) using `imap` + `mailparser` npm packages. LinkedIn alert emails are consistent HTML — parse out job title, company, location, and the job URL for each listing. Each parsed job is stored in SQLite as a stub record with status `"Needs Full Data"`. Fields that can't be extracted from the email (full description, salary, job type) are left empty and flagged.

**Path 2 (Enrichment): Embedded Browser via Electron BrowserView / WebContentsView**
An embedded Chromium browser panel is built into the app using Electron's `BrowserView` (or the newer `WebContentsView`). The user logs into LinkedIn once inside this panel — session cookies are persisted locally in a dedicated browser partition (isolated from the user's main Chrome profile). This authenticated session is reused for all subsequent enrichment fetches without requiring re-login.

Enrichment workflow:
- The Job Board displays all stub records with a checkbox column
- User selects up to **10 jobs** manually using checkboxes, then clicks **"Enrich Selected"**
- The app iterates through selected jobs sequentially: the embedded browser navigates to each job URL, waits for the page to fully render, then uses `webContents.executeJavaScript()` to extract the full DOM — capturing: complete job description, salary range (if shown), seniority level, job type, number of applicants, easy apply vs. external link
- Between each fetch, insert a **random delay of 2–15 seconds** (use `Math.random() * 13000 + 2000` ms) to avoid triggering LinkedIn's bot detection
- A progress indicator shows "Enriching job 3 of 8... waiting Xs before next fetch"
- On completion, stub records are promoted to full records; status updates to `"To Apply"`
- If a fetch fails (page error, redirect to login), mark that job `"Enrichment Failed"` and continue with the rest — never block the queue

**Path 3 (Fallback): Manual paste / URL input**
User pastes a LinkedIn job URL or the full job description text directly. Always available regardless of email or browser setup.

All ingested jobs are stored in SQLite.

**Job Board (left panel or full width list):**
- Cards showing: company logo (fetched from Clearbit Logo API), title, location, date added, status badge
- Click a job card to open the **Application Workspace** (right panel or modal)

### 3B. Application Workspace (per job)

Layout: Split view — job description on left (scrollable, read-only), generated materials on right (tabbed).

**Tabs in the right panel:**

**Tab 1 — Resume**
- Button: **Generate Tailored Resume**
- LLM prompt: Takes the user's master resume (stored as a base document in Settings, uploaded once as `.docx` or plain text) and the job description, and returns a tailored resume optimized for this role.
- Resume formatting requirements (bake into system prompt):
  - ATS-friendly: no tables, no text boxes, no headers/footers with critical info, no graphics
  - Clean single-column or two-column layout with standard section names (Summary, Experience, Skills, Education, Publications)
  - Keywords from job description naturally woven in
  - Bullet points: strong action verbs, quantified impact where possible
- Output displayed in a rich text editor (TipTap) — fully editable inline
- Revision bar (same pattern as Module 1): type instruction → LLM updates → streams back into editor
- **Export panel:**
  - **Save as .docx** — uses the `docx` npm library to generate a Word document
  - **Save as PDF** — renders the editor content to PDF via Puppeteer or jsPDF
  - **Save plain text version** — saves `.txt` with clean formatting for copy-paste into ATS portals
  - All three saved automatically to: `[Root Output Folder]/[Company Name] — [Job Title] — [YYYY-MM-DD]/`
  - Files named: `[LastName]_[Company]_[RoleShort]_Resume.docx`, etc.

**Tab 2 — Cover Letter**
- Same generate → edit → export flow as Resume tab
- System prompt instructs: concise (3–4 paragraphs), specific to role and company, avoid generic openers, reference 1–2 specific things about the company
- Export: `.docx`, `.pdf`, `.txt`

**Tab 3 — Recruiter Message**
- Generates a short (150–250 word) direct LinkedIn message or email to the hiring manager or recruiter
- Editable in TipTap rich text editor
- Revision bar with character counter (configurable limit, default 300 chars) — useful for LinkedIn message constraints
- Copy to clipboard button

**Tab 4 — Application Q&A**
- Open chat interface for answering job portal questions (e.g., "Why do you want to work here?", "Describe a time you led a cross-functional project")
- User types the question from the portal; LLM responds in context of this specific job + user's background
- Response shown in editable text area with **character limit field** (user sets e.g., 500 chars) — live counter shown
- Copy button per response
- Full conversation history maintained per job application

**Tab 5 — Notes**
- Free-form markdown notes field (use CodeMirror or simple textarea)
- Auto-saved to SQLite

---

## Module 4: Application Tracker Dashboard

### Purpose
Track all job applications with structured data and visualize pipeline metrics.

### Data Entry
- When a job is moved from "To Apply" → "Applied" in Module 3, prompt user to confirm/fill:
  - Application date (auto-filled to today)
  - Salary/rate (from scraped data or manual entry; range or single value)
  - Source (LinkedIn, company site, referral, etc.)
  - Remote / Hybrid / In-person
  - City, State
- All other fields auto-populated from the job card (company, title, URL)

### Tracker Table
Full-width sortable, filterable table with columns:
- Company | Role Title | Location (City, State) | Remote? | Salary Range | Date Applied | Source | Status | Last Updated | Notes

**Status options** (color-coded badges):
- To Apply (gray)
- Applied (blue)
- No Response (light gray, auto-set after configurable days)
- Positive Contact — Email (green)
- Positive Contact — Phone/Interview (bright green)
- Offer (gold)
- Rejected (red)
- Withdrawn (orange)

User can click any row to open the full Application Workspace for that job (links back to Module 3).

### Analytics Panel (below or beside table)
Charts built with Recharts:

1. **Pipeline Funnel** — count of applications at each status stage
2. **Response Rate** — pie or donut: % positive contact / % rejected / % no response
3. **Applications Over Time** — line chart of cumulative applications by week
4. **Location Map / Bar Chart** — applications by state or city
5. **Salary Distribution** — histogram of salary ranges for applied roles
6. **By Source** — bar chart of which sources (LinkedIn, referral, etc.) produce the most positive responses

All charts update reactively as the table data changes.

---

## File System & Export Conventions

### Output Folder Structure
```
[Root Output Folder]/
  [Company] — [Job Title] — [YYYY-MM-DD]/
    [LastName]_[Company]_[RoleShort]_Resume.docx
    [LastName]_[Company]_[RoleShort]_Resume.pdf
    [LastName]_[Company]_[RoleShort]_Resume_PlainText.txt
    [LastName]_[Company]_[RoleShort]_CoverLetter.docx
    [LastName]_[Company]_[RoleShort]_CoverLetter.pdf
    notes.md
```

### Master Resume Storage
- User uploads their base resume once in Settings (`.docx` or paste as text)
- Stored locally; used as context for all resume generation

---

## LLM API Abstraction Layer

Create a single `llm.ts` module that:
- Accepts: `{ provider: 'anthropic' | 'openai', model: string, messages: ChatMessage[], systemPrompt: string, stream: boolean }`
- Handles streaming responses (Server-Sent Events for Anthropic, stream chunks for OpenAI)
- Streams tokens into the active editor in real time
- Handles errors gracefully with user-visible toast notifications
- Stores no conversation data externally — all history is local SQLite only

---

## UI / UX Design Principles

- **Dark theme**: Background `#1a1a1a`, surface `#252525`, accent `#7c6af7` (purple, Obsidian-like), text `#e8e8e8`
- **Typography**: Inter or JetBrains Mono for code/technical content
- **Sidebar**: Collapsible icon-only mode
- **Toasts**: Non-blocking notifications for save confirmations, API errors, export success
- **Keyboard shortcuts**: `Cmd/Ctrl+Enter` to generate/send revision, `Cmd/Ctrl+S` to save, `Cmd/Ctrl+E` to export
- **Loading states**: Skeleton loaders for paper cards; streaming indicator (blinking cursor) in editors during LLM generation
- **Responsive within desktop**: App should work at 1280px wide minimum

---

## Build Order (Suggested Phases)

**Phase 1 — Foundation**
- Electron/Tauri scaffold + React + Tailwind dark theme
- Sidebar navigation routing to four empty module views
- Settings panel: API key storage, model selection, output folder picker, master resume upload

**Phase 2 — LLM Layer + Post Generator**
- Build `llm.ts` abstraction with streaming
- Module 1: URL fetch/PDF parse → generate post → TipTap editor → revision loop

**Phase 3 — Paper Discovery**
- PubMed API integration + RSS feed parsing
- SQLite paper storage
- Filter/sort UI + paper cards

**Phase 4 — Job Search Workspace**
- Job ingestion (paste URL / paste text)
- Application Workspace tabs: Resume, Cover Letter, Recruiter Message, Q&A
- File export (.docx, .pdf, .txt)

**Phase 5 — Application Tracker**
- Tracker table with status management
- Recharts analytics dashboard

---

## Notes & Constraints

- **LinkedIn data access**: Do not use LinkedIn's official API or any OAuth flow. All LinkedIn data is retrieved via the embedded Electron `BrowserView`/`WebContentsView` using the user's own authenticated session. The browser partition is isolated from the user's main browser profile. The random delay between enrichment fetches must be 2–15 seconds (`Math.floor(Math.random() * 13000) + 2000` ms). Maximum 10 jobs per enrichment batch — enforce this hard limit in the UI (disable "Enrich Selected" if more than 10 are checked, show a tooltip explaining the limit).
- **Altmetric API**: Free tier supports DOI lookups; cache results in SQLite to avoid rate limits.
- **PDF parsing**: `pdfjs-dist` is more reliable than `pdf-parse` for complex academic PDFs; prefer it.
- **ATS Resume Formatting**: The `.docx` export must use standard paragraph styles (not text boxes or tables for layout). Use the `docx` npm library's `Paragraph` and `TextRun` primitives directly.
- **Security**: API keys must never be logged or sent to any third party. Store encrypted locally using `safeStorage` (Electron) or OS keychain.
- **Error handling**: Every LLM call and external API call must have try/catch with user-visible error messages. Never silently fail.
