# Professional Dashboard App — Refined Specification
*Synthesized from original prompt + design interview — 2026-02-18*

---

## Overview

A professional desktop dashboard application for a biomedical scientist. Built with **Electron + React**, local SQLite database for persistence, and a dark-themed UI inspired by Obsidian. Four major modules accessible via a persistent left sidebar: **Post Generator**, **Paper Discovery**, **Job Search**, and **Application Tracker**. All LLM interactions route through a configurable API layer (user provides their own API keys for Anthropic Claude and/or OpenAI). A global **Settings** panel handles API key management, model selection, folder configuration, and email/LinkedIn session setup.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + TypeScript | |
| Styling | TailwindCSS | Dark theme, Obsidian-inspired |
| Runtime | **Electron** (Node.js) | Tauri explicitly ruled out — Node.js npm ecosystem required for IMAP, PDF parsing, SQLite |
| Database | SQLite via `better-sqlite3` | |
| ORM (optional) | Drizzle ORM | Wrap better-sqlite3 if needed |
| Rich text editor | **TipTap** | Post Generator, Resume, Cover Letter, Recruiter Message |
| Notes editor | **CodeMirror** | Notes tab only (better markdown support) |
| LLM providers | Anthropic Claude, OpenAI | Abstracted via single `llm.ts` module |
| Document gen | `docx` npm package | .docx export |
| PDF export | Puppeteer or jsPDF | .pdf export |
| PDF parsing | `pdfjs-dist` | Academic PDF ingestion (preferred over pdf-parse for complex layouts) |
| Web fetch | `node-fetch` + `cheerio` | Article URL scraping |
| Company page render | Electron BrowserView (reused) | JavaScript-heavy company pages for cover letter research |
| Email parsing | `imap` + `mailparser` | IMAP polling |
| Charts | Recharts | All analytics charts |
| Map | Leaflet | Location analytics chart |
| Embedded browser | Electron `WebContentsView` | LinkedIn enrichment + company page fetching |
| API key storage | `safeStorage` (Electron built-in) | Encrypted at rest; no OS keychain prompts |
| Sync | User-configured iCloud / Dropbox path | SQLite file stored at user-set path with lock file |

---

## Global Architecture

### Window Behavior
- Clicking the macOS red close button **minimizes to Dock only** — the app continues running (preserves IMAP polling background behavior)
- `Cmd+Q` fully quits
- On Windows: standard minimize/tray behavior

### Database Location & Sync
- Default: Electron `app.getPath('userData')/dashboard.db`
- Settings option: **"Database location"** file picker — user can point to an iCloud Drive or Dropbox folder path for automatic cloud sync
- **Lock file mechanism**: on launch, the app writes `dashboard.lock` alongside the `.db` file containing the PID and timestamp. On subsequent launches (or if another machine opens the same path), the app detects the existing lock file and shows a warning banner: *"This database may be open on another machine. Continuing may cause corruption."* with options: Open Anyway / Cancel
- On clean exit, the lock file is deleted

### Settings Panel

**API Keys** (stored via Electron `safeStorage`, never logged or transmitted):
- Anthropic Claude API key
- OpenAI API key
- PubMed / NCBI E-utilities API key

**Model Selection** (per-module):
- Editable text field with autocomplete suggestions from a curated known-models list
- Known list includes: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, `gpt-4o`, `gpt-4o-mini`
- User can type any model string to support future releases without an app update
- Each module has its own model selector: Post Generator, Paper Discovery, Job Search (Resume), Job Search (Cover Letter), Job Search (Q&A), Application Tracker

**Default Output Folder**: file picker for exported resume/cover letter files

**Master Resume Bases** (multiple named profiles):
- User can create multiple named base resumes (e.g., "Research Track", "Industry Track")
- Each base can be uploaded as `.docx` or pasted as plain text
- No versioning within a base — overwriting replaces it. Previously generated files (already exported) are unaffected
- Displayed as a list; user can add, rename, delete bases

**Database Location**: path picker for SQLite sync path (see above)

**Job Alert Email (IMAP)**:
- Fields: Host, Port, Username (email), App Password (16-char Google App Password), TLS toggle
- Authentication: **App Password only** — no OAuth2 flow. Documented in UI tooltip: "Generate a Google App Password at myaccount.google.com/apppasswords"
- **Forwarding address field**: A separate field labeled "LinkedIn alert forwarding address" — the Gmail alias or forwarding address that LinkedIn alert emails come FROM (may differ from the IMAP inbox address). This is the primary sender filter for email processing.
- **"Test Connection"** button: verifies IMAP credentials
- **"Test Parsing"** button: fetches the 5 most recent emails from the inbox and displays a diagnostic panel showing for each email: detected sender, subject line, `X-Forwarded-To`, `X-Original-From`, and `Reply-To` headers. User can verify the filter will catch the right emails before relying on it.

**LinkedIn Session**:
- Button to open the embedded browser panel for LinkedIn login
- Session stored in an isolated Electron browser partition (completely separate from user's main browser profile)
- "Log out" button clears the session partition

**PubMed Search Profiles**: Manage named search profiles (see Module 2)

---

### Sidebar Navigation
- Four module icons + labels: **Post Generator | Paper Discovery | Job Search | Application Tracker**
- Settings gear icon pinned to the bottom
- **Collapsible**: toggles to icon-only mode
- Clicking any icon while in icon-only mode **expands the sidebar** back to full width (regardless of whether that module is already active)
- Active module icon is highlighted

---

## Module 1: LinkedIn Science Post Generator

### Purpose
Generate LinkedIn posts about scientific literature following a strict house style, with iterative editing via an embedded rich text editor and LLM API back-and-forth.

### Session Persistence
- Each post generation session (source content + full LLM conversation history) is saved to SQLite
- Auto-pruned: the app retains the **last 20 sessions**; oldest sessions are deleted automatically
- User can browse past sessions from a session list panel and resume or re-export any saved session

### Layout
Split view: Input panel (~40% width, left) | Editor panel (~60% width, right)

### Input Panel
- **Source input area** — accepts any combination of:
  - Paste a URL (article page, newsletter, bioRxiv/medRxiv preprint)
  - Upload a PDF (drag-and-drop zone) — parsed via `pdfjs-dist`
  - Paste raw text / abstract directly
- URL field does **not** auto-fetch on paste. User must click **"Fetch & Parse"** explicitly.
- **Fetch & Parse button**: fetches/parses the source and displays a collapsible preview card showing extracted title, authors, journal, and abstract for the user to confirm
- When arriving via "Send to Post Generator" from Paper Discovery: the URL is pre-filled in the URL field and the preview card is pre-populated from stored metadata (bypasses the Fetch step). The user notes field is left blank.
- **User notes field**: free-text box for user's own interpretation, angle, or emphasis before generation
- **Generate Post button** (`Cmd/Ctrl+Enter` when focus is in the notes field or anywhere outside the editor)

### LLM System Prompt (baked in, not user-editable):
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

### Output / Editor Panel
- **TipTap rich text editor** displaying the generated post
- User can edit text directly inline
- **Generation UX**: clicking "Generate Post" shows a skeleton/spinner overlay on the editor. Full response is inserted when generation completes (no token-by-token streaming into editor). If the API call fails, the editor reverts to its pre-generation state and an error toast is shown.
- **Revision toolbar** above the editor:
  - Text input: "Request a revision..."
  - **Send revision** button (`Cmd/Ctrl+Enter`) — appends current editor content + revision note to conversation history, calls LLM, inserts full response when done
  - **Regenerate from scratch** button — opens a modal:
    - Option A: "Start fresh" — clears the conversation history, editor, and re-runs original generation from the source content
    - Option B: "Ask LLM to try again" — appends a message to the existing conversation requesting a completely new version; conversation continuity preserved
  - **Undo / Redo** (TipTap native history)
- **Word count**: live count of **body text only** (title and hashtags excluded). Green if 200–250, yellow if ±25 words from range, red otherwise.
- **Copy to clipboard**: copies plain text with **paragraph breaks preserved as `\n\n`** (matching LinkedIn's paste behavior). All inline markdown stripped.
- **Conversation history panel**: right-side drawer that slides over the editor when toggled. Shows full LLM back-and-forth for the current session as a chat thread. Toggle button in the revision toolbar.

### Context Window Management
When the conversation array approaches the model's context limit (tracked by estimated token count), the app automatically:
1. Calls the LLM to summarize the conversation so far into a compact summary
2. Replaces all prior messages with a single `system` summary message
3. Continues the session transparently. User is not interrupted.

### Conversation Model
Each "Send revision" call appends to a `messages` array:
1. `assistant` message = current post text in editor (before revision)
2. `user` message = revision instruction

This allows multi-turn iteration with full context.

---

## Module 2: Paper Discovery Dashboard

### Purpose
Aggregate scientific literature from PubMed, preprint servers, and manual input into a single filterable dashboard.

### Data Sources & Fetch Scheduling
- **PubMed / NCBI E-utilities API**: Fetches run **on every app launch** (catch-up for any missed time) and then on a configurable interval while the app is open (daily / weekly toggle). Results stored in SQLite.
- **bioRxiv/medRxiv RSS feeds**: Parsed for configured keyword terms on the same schedule.
- **Manual add**: User pastes a DOI or PubMed ID to add a paper directly.
- *(Future)* OpenAlex API for citation counts and download metrics.

### PubMed Search Profiles
- User creates **multiple named search profiles** (e.g., "Macrophage Polarization", "Biomaterials", "Cell Therapy")
- Each profile has its own keyword list, MeSH terms, author names, and journal filters
- Profiles run independently; each paper is tagged with the profile name(s) that triggered it
- Profile management UI in Settings: add / rename / delete profiles, configure terms per profile

### Deduplication
- **DOI-based deduplication only**: papers with matching DOIs are treated as the same record
- Preprint (bioRxiv DOI) and published version (journal DOI) are stored as separate entries since DOIs differ
- No fuzzy title matching

### Paper Card Display
Each paper shown as a card with:
- Title, authors (truncated after 3), journal name, publication date
- Abstract (collapsed by default, expandable)
- Impact factor badge (sourced from a bundled journal IF lookup table — SCImago or JIF dataset)
- **Trending badge**: three-tier categorical — **Hot** (top 5% by trending score), **Rising** (top 25%), no badge otherwise. Score sourced from Altmetric free tier (DOI lookup, results cached in SQLite to avoid rate limits), or citation proxy via OpenAlex if Altmetric is unavailable.
- Tags showing which search profile(s) triggered this paper
- Action buttons:
  - **Open PDF**: if a local file path is linked, opens the file in the system default PDF viewer via `shell.openPath()`. If no path is linked, opens the DOI URL in the system browser. If the stored path no longer exists on disk, shows a warning badge on the card: "PDF path broken — click to update."
  - **Link / Update PDF Path**: opens a file picker to link or re-link a local PDF path. Stores the absolute path in SQLite. No file is copied or downloaded.
  - **Open in Browser**: opens DOI/PubMed URL in system browser
  - **Send to Post Generator**: pre-fills Module 1 with the paper's URL in the URL field and title + authors in the preview card (bypassing the Fetch step). Auto-saves any active Post Generator session before navigating.
  - **Save / Star**

### Filters & Sorting (persistent filter bar at top)
- Date range picker
- Journal multi-select dropdown
- Impact factor range slider (0–50+)
- Trending badge filter (Hot / Rising / All)
- Search profile / tag filter chips
- Read / Unread / Starred toggle
- Text search (title + abstract)

### Layout
Grid or list toggle. Default: list with compact cards. Pagination or infinite scroll.

---

## Module 3: Job Search & Application Workspace

### 3A. Job Postings Aggregator

#### Data Ingestion — Three Paths

**Path 1 (Primary): IMAP Email Parsing**

Polls the configured IMAP inbox on launch and on a configurable interval (default: every 30 minutes while app is open).

Email filtering logic:
1. **Primary filter**: sender address matches the "LinkedIn alert forwarding address" configured in Settings
2. **Secondary confirmation**: inspect `X-Forwarded-To`, `X-Original-From`, and `Reply-To` headers for `linkedin.com` domain presence. Log detected header values to a per-email diagnostic record in SQLite (visible in the "Test Parsing" diagnostic panel in Settings).
3. Emails failing both checks are skipped silently

Parsed fields per job: title, company, location, job URL. Fields not in email (full description, salary, job type) are left empty and flagged with status `"Needs Enrichment"`.

**Path 2 (Enrichment): Embedded Browser via Electron WebContentsView**

The embedded Chromium panel is used for both LinkedIn job enrichment and company homepage research (cover letter). It is shown as a **collapsible debug panel** — hidden during normal operation, accessible via a "Show browser" toggle button for debugging. During enrichment, the user sees only a progress indicator.

Enrichment workflow:
- Job Board displays all `"Needs Enrichment"` records with a checkbox column
- User selects up to **10 jobs** (UI enforces hard limit: "Enrich Selected" button is disabled if >10 are checked; tooltip explains the limit)
- App iterates sequentially: embedded browser navigates to each job URL, waits for full render, uses `webContents.executeJavaScript()` to extract: full job description, salary range, seniority level, job type, number of applicants, Easy Apply vs. external link
- **Primary extraction**: structured DOM selectors targeting known LinkedIn elements
- **Fallback if extraction returns blank/malformed data**: send raw page HTML to the configured LLM and ask it to extract the fields. Log the fallback trigger.
- Random delay between fetches: `Math.floor(Math.random() * 13000) + 2000` ms (2–15 seconds)
- Progress indicator: "Enriching job 3 of 8... waiting Xs before next fetch"
- Failed fetches (error, redirect to login): mark job `"Enrichment Failed"`, continue queue
- On completion, successfully enriched jobs update to status `"No Response"`

**Path 3 (Manual / Quick Add)**

Available regardless of IMAP or LinkedIn setup. A "Quick Add" button opens a modal with:
- Company name (required)
- Job title (required)
- Job posting URL (optional but recommended for AI features)
- Application date (required, defaults to today)
- "Fetch job description now" checkbox (default: checked if URL is provided) — if checked, queues the job for enrichment immediately after adding
- Full job description is not required at Quick Add time but can be pasted/fetched later

All ingested jobs are stored in SQLite.

#### Job Board (left panel or full-width list)
- Cards showing: company logo (fetched from Clearbit Logo API using inferred domain — try `companyname.com` first, fall back to placeholder initials icon), title, location, date added, status badge
- Click a job card to open the Application Workspace (right panel or modal)

---

### 3B. Application Workspace (per job)

Layout: Split view — job description on left (scrollable, read-only) | generated materials on right (tabbed)

#### Tab 1 — Resume

- **Base resume selector** (prompted at generation time): clicking "Generate Tailored Resume" opens a modal first: "Which base resume to use?" showing all named base resumes. User selects one, then generation begins.
- LLM system prompt requirements (baked in):
  - ATS-friendly: no tables, no text boxes, no headers/footers with critical info, no graphics
  - Single-column or two-column layout with standard section names (Summary, Experience, Skills, Education, Publications)
  - Keywords from job description naturally woven in
  - Bullet points: strong action verbs, quantified impact
  - **Publications section**: "Do not modify the Publications section. Copy it exactly from the base resume."
- Output displayed in **TipTap** editor — fully editable inline
- Generation UX: skeleton/spinner overlay; full response inserted on completion; reverts on failure
- Revision bar: type instruction → LLM updates → insert full response
- **Export panel**:
  - **Save as .docx**: uses `docx` npm library. Full fidelity: bold → `TextRun({ bold: true })`, italic → `TextRun({ italics: true })`, headings → standard Word Heading styles, bullets → `ListItem` paragraphs. ATS-safe standard styles throughout — no text boxes, no tables for layout.
  - **Save as PDF**: Puppeteer or jsPDF renders editor content
  - **Save plain text**: `.txt` with clean paragraph formatting for ATS portals
  - All three auto-saved to: `[Root Output Folder]/[Company] — [Job Title] — [YYYY-MM-DD]/`
  - Files named: `[LastName]_[Company]_[RoleShort]_Resume.docx`, etc.

#### Tab 2 — Cover Letter

- **Company research step** (before generation):
  1. App attempts to load the company's homepage/about page in the embedded browser to capture JavaScript-rendered content
  2. Extracted text is shown in an **editable "Company research" text area** — user can read, edit, or prune the summary before generating
  3. "Generate Cover Letter" button passes this research + job description + selected base resume to the LLM
- System prompt requirements (baked in): concise (3–4 paragraphs), specific to role and company, avoid generic openers, reference 1–2 specific things about the company from the research
- Same generate → TipTap editor → edit → revision bar → export flow as Resume tab
- Export: `.docx`, `.pdf`, `.txt` to same folder as resume

#### Tab 3 — Recruiter Message

- Generates a short (150–250 word) direct LinkedIn message or email
- Opening: `Hi [Name],` with a literal `[Name]` placeholder — user manually replaces before copying
- Editable in TipTap
- Revision bar with live **character counter** (configurable limit, default 300 chars)
- Copy to clipboard button

#### Tab 4 — Application Q&A

- Open chat interface for answering job portal questions
- LLM context for each answer: selected base resume + job-specific notes (Tab 5) + cover letter text if already generated
- User types question → LLM responds
- **Character limit field** per question (user sets e.g., 500 chars); live counter shown
- Copy button per response
- **"Save as Template"** button on any response — saves the question + answer to a reusable Q&A template library. Templates are accessible via a "Use Template" dropdown when starting a new question, filterable by keyword.
- Full Q&A conversation history maintained per job application in SQLite

#### Tab 5 — Notes

- Free-form markdown notes using **CodeMirror** editor
- Auto-saved to SQLite on change

#### "Mark as Applied" Action

A prominent **"Mark as Applied"** button appears in the Application Workspace header (visible on all tabs). This is the explicit trigger that creates a tracker entry in Module 4.

On click, a modal prompts:
- **Application date** (required, defaults to today — editable)
- **Salary range** (optional)
- **Remote / Hybrid / In-person** (optional)
- **Application source** (optional, defaults to "LinkedIn"; other options: Company Site, Referral, Job Board, Other)

On confirmation, a tracker entry is created with default status `"No Response"` and the above fields recorded.

---

## Module 4: Application Tracker

### Purpose
Track all submitted applications with structured data and visualize pipeline metrics.

### Status Model

Being in the tracker implies the user has applied. The tracker's status reflects **response state**, not application state.

Status options (color-coded badges):
| Status | Color | Notes |
|---|---|---|
| No Response | Gray | **Default** — set on creation. Indicates no communication received. |
| Positive Contact — Email | Green | Received an encouraging email/message |
| Positive Contact — Phone/Interview | Bright green | Phone screen or interview scheduled/completed |
| Offer | Gold | Formal offer received |
| Rejected | Red | |
| Withdrawn | Orange | User withdrew application |

No automatic status transitions or time-based thresholds.

### Tracker Table (Table tab)

Full-width sortable, filterable table with columns:
- Company | Role Title | Location | Remote? | Salary Range | Date Applied | Source | Status | Last Updated | Notes (inline)

Each row is clickable — opens that job's Application Workspace in Module 3.

**Deletion policy**:
- Default UI action for removing an entry: set status to **Withdrawn** (preserves analytics integrity)
- **Hard delete** is available via Settings → "Manage Data" → select entries → Delete, or via a keyboard shortcut (`Cmd+Delete` on a selected row) with a confirmation dialog. Intended for test entries / duplicates.

### Analytics Panel (Analytics tab)

Full-page view replacing the table when the "Analytics" tab is selected. Charts built with Recharts:

1. **Pipeline Funnel** — count at each status stage
2. **Response Rate** — donut chart: % Positive Contact / % Rejected / % No Response
3. **Applications Over Time** — cumulative line chart by week
4. **Location Map** — **Leaflet** choropleth or dot map showing applications by state/city
5. **Salary Distribution** — histogram of salary ranges for tracked roles
6. **By Source** — horizontal bar chart: which sources produce the most positive responses

All charts update reactively as tracker data changes.

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

### PDF File Linking (Paper Discovery)
- Paper records store an **absolute file path** to a local PDF — no file is copied or downloaded
- App uses `fs.existsSync()` on launch and when a card is rendered to detect broken paths
- Broken path indicator: orange warning icon on the paper card with tooltip "PDF path not found. Click to relink."
- "Link PDF" action opens a file picker to update the stored path

---

## LLM API Abstraction Layer (`llm.ts`)

Single module handling all LLM calls:

```typescript
interface LLMRequest {
  provider: 'anthropic' | 'openai';
  model: string;
  messages: ChatMessage[];
  systemPrompt: string;
  stream: boolean;
}
```

- **Streaming**: not used for editor insertion — app waits for the full response and inserts it at once. Streaming flag may be used for future progress indication.
- **Context window management**: each module's conversation manager tracks estimated token count. When approaching 80% of the model's context limit, triggers the summarize-and-compress routine before the next call.
- **Error handling**: every call wrapped in try/catch. On failure: revert any pending editor changes, show a toast notification with the error type (network error / rate limit / invalid key / etc.). Never silently fail.
- **No external data storage**: all conversation history in local SQLite only. API keys never logged.

---

## UI / UX Design Principles

**Color tokens:**
- Background: `#1a1a1a`
- Surface: `#252525`
- Accent: `#7c6af7` (purple)
- Text primary: `#e8e8e8`
- Success: `#4caf82`
- Warning: `#f5a623`
- Error: `#e05252`

**Typography**: Inter (UI text), JetBrains Mono (code, technical content, CodeMirror notes)

**Layout**: Minimum supported width 1280px

**Sidebar**: Collapsible to icon-only mode. Clicking any icon while collapsed expands the sidebar.

**Toasts**: Non-blocking, auto-dismiss after 4 seconds (errors stay until dismissed). Stack up to 3 visible.

**Loading states**:
- Paper cards: skeleton loaders
- LLM generation: spinner/skeleton overlay on the editor
- Enrichment: in-app progress indicator ("Enriching job 3 of 8... waiting Xs")

**Keyboard shortcuts**:
- `Cmd/Ctrl+Enter` — Generate / Send revision (context-sensitive)
- `Cmd/Ctrl+S` — Save (notes, workspace)
- `Cmd/Ctrl+E` — Export (active document)
- `Cmd/Ctrl+Delete` — Hard delete (tracker entry, with confirmation)

---

## Testing

Unit tests for core business logic only (no UI tests, no e2e):
- `llm.ts` abstraction layer (mock API responses, context management, error handling)
- SQLite query functions (CRUD for jobs, papers, sessions, tracker entries)
- Document generation (`docx` export — verify structure and styles)
- PDF path validation logic
- IMAP email parsing and header inspection logic
- Conversation summarize-and-compress routine

Test runner: **Jest** with TypeScript support.

---

## Build Order (Phases)

### Phase 1 — Foundation
- Electron scaffold + React + TypeScript + Tailwind dark theme
- Sidebar navigation routing to four empty module views
- Settings panel: API key storage (`safeStorage`), model selection (editable text + suggestions), output folder picker, database location picker + lock file logic, master resume base management

### Phase 2 — LLM Layer + Post Generator
- Build `llm.ts` abstraction (full response, error handling, context management)
- Module 1: URL fetch → PDF parse (`pdfjs-dist`) → TipTap editor → revision loop → session persistence + auto-prune → word count → clipboard copy

### Phase 3 — Paper Discovery
- PubMed E-utilities + RSS feed integration
- Named search profile management
- SQLite paper storage + DOI dedup
- Paper cards with trending badges, PDF path linking, broken path detection
- Filters/sort UI

### Phase 4 — Job Search Workspace
- IMAP email parser (forwarding address filter + header inspection + Test Parsing button)
- LinkedIn enrichment via WebContentsView (structured extraction + LLM fallback)
- Quick Add modal + Job Board
- Application Workspace: all 5 tabs
- Base resume selector modal on generate
- Cover letter company research flow (embedded browser + preview/edit step)
- Q&A template library
- "Mark as Applied" modal → tracker entry creation
- File export (.docx full fidelity, .pdf, .txt)

### Phase 5 — Application Tracker
- Tracker table with status management + hard delete (Settings path)
- Recharts analytics + Leaflet location map
- Status badge logic

### Phase 6 — Polish + Testing
- Unit test suite (Jest)
- Toast system refinement
- Keyboard shortcuts
- Session browser in Post Generator
- Sync path + lock file edge case handling

---

## Notes & Constraints

**LinkedIn data access**: No official API or OAuth. All data via `WebContentsView` using the user's authenticated session in an isolated browser partition. Random delay 2–15 seconds between enrichment fetches (`Math.floor(Math.random() * 13000) + 2000` ms). Hard limit: 10 jobs per enrichment batch — enforce in UI.

**LinkedIn DOM resilience**: Primary extraction uses structured CSS selectors. When extraction returns blank or malformed data, fall back to sending the raw HTML to the LLM for field extraction. Log each fallback occurrence.

**IMAP**: Gmail App Password only. Primary filter: forwarding address configured in Settings. Secondary: header inspection for `linkedin.com`. "Test Parsing" diagnostic shows last 5 emails with detected headers.

**PDF parsing**: `pdfjs-dist` for academic PDFs. Worker configuration required for Electron renderer — use `pdfjsWorker` from `pdfjs-dist/build/pdf.worker.entry` and configure via `GlobalWorkerOptions.workerSrc`.

**ATS Resume .docx**: Use `docx` library `Paragraph` and `TextRun` primitives only. No tables, no text boxes, no graphics. Standard Word paragraph styles for headings and lists. Publications section must be copied verbatim, never modified by the LLM.

**API keys**: Never logged, never transmitted to any third party. Stored via Electron `safeStorage`. Displayed in Settings as masked fields with a reveal toggle.

**Altmetric**: Free tier for DOI lookups. Cache results in SQLite with a 7-day TTL to avoid rate limits.

**Clearbit Logo**: Domain inferred from company name (`companyname.com` heuristic). On 404 or fetch failure, render placeholder initials icon.

**Error handling**: Every LLM call, IMAP poll, enrichment fetch, and external API call must have explicit try/catch with user-visible error messages via the toast system. Never silently fail.

**iCloud/Dropbox sync**: Storing an SQLite file in a cloud-synced folder carries corruption risk if the file is synced while open. The lock file mechanism mitigates this. Document in Settings tooltip: "Ensure the database is not open on another machine when using cloud sync."
