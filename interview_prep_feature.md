# Feature Spec: Interview Prep Module

## Overview

The Interview Prep module helps the user prepare for job interviews by combining everything the app already knows — the job posting, tailored resume, cover letter, and user background — with live LLM-powered company research and a structured mock interview experience. It is accessible in two ways: as a dedicated **tab within the Job Application Workspace** (alongside Resume, Cover Letter, Q&A, etc.) and as a **top-level sidebar shortcut** that opens the most recently viewed Interview Prep tab. The sidebar entry should only appear once at least one job has been added to the system.

---

## Architecture Overview

The module has two distinct phases that the user moves through sequentially, though they can return to either at any time:

**Phase 1 — Research Brief**: LLM-powered web research on the company, role, and relevant domain, compiled into a structured report.

**Phase 2 — Mock Interview**: Interactive chat where the LLM plays interviewer, drawing on the research brief, job posting, resume, and Q&A template library to ask realistic questions and provide structured feedback.

Both phases are scoped to a specific job record. All data (research brief content, mock interview sessions and answers) is persisted to SQLite and linked to the job's ID.

---

## Phase 1: Research Brief

### Research Depth Selection

On first opening the Interview Prep tab for a given job (with no existing brief), the user is presented with a single choice before research begins:

- **Quick Brief** — surface-level synthesis, targets ~2 minutes of generation time. Covers the essentials only.
- **Deep Research** — thorough multi-search investigation, targets ~5–10 minutes. More sources, more depth, citations included.

This selection is shown as two clearly labeled cards with a short description of what each covers. The choice is saved per job so returning to the tab doesn't re-prompt — but a "Re-run Research" button (with depth re-selection) is always available in the brief header.

**Interaction with the Settings default**: If the user has set a default research depth in Settings ("Quick" or "Deep"), the corresponding card is pre-selected when the depth-selection screen appears. The user still sees the card UI and must click an explicit "Start Research" button — the setting never auto-triggers research. If the setting is "Always ask," neither card is pre-selected.

### Web Search Implementation

Research is performed using the LLM API with web search tool enabled. The specific web search tool used is determined automatically by whichever model is selected in Settings for the Interview Prep module:

- If the selected model is an Anthropic Claude model → use Anthropic's native `web_search` tool (type: `web_search_20250305`)
- If the selected model is an OpenAI model → use OpenAI's web search tool (responses API, type: `web_search_preview`)

#### Normalized SearchEvent in llm.ts

Add a `webSearch: boolean` parameter to the LLM call interface. When `true`, the appropriate tool definition is appended to the API request for the active provider.

Because Anthropic and OpenAI expose search events in structurally different ways (Anthropic emits `tool_use` blocks mid-stream; OpenAI uses the responses API with its own event shape), `llm.ts` must define a provider-agnostic `SearchEvent` type:

```ts
type SearchEvent = {
  type: 'search_start' | 'search_complete';
  query: string | null; // extracted from tool input where available
  provider: 'anthropic' | 'openai';
};
```

Each provider adapter is responsible for translating its native stream events into `SearchEvent` before emitting upstream. The calling code (Research Brief UI) subscribes to `SearchEvent` emissions to drive the live status indicator (e.g., "Searching for recent news...", "Searching PubMed for publications..."). If the query text cannot be extracted from the event, the status indicator falls back to a generic "Searching..." message.

#### Error Handling During Research

If a web search fails or times out mid-generation:
1. Automatically retry the failed search once.
2. If the retry also fails, continue generation with whatever data is available.
3. Save the resulting brief with a visible **partial-data notice** at the top: "Some searches failed during generation. This brief may be incomplete. You can re-run research to get a full brief."

### Research Scope

The system prompt instructs the LLM to research and synthesize the following, using web search as needed:

**Company Overview**
- Mission, vision, and stated values
- Company size, funding stage or public status, recent financial news
- Recent news (past 6 months): acquisitions, partnerships, leadership changes, layoffs, expansions
- Primary products, platforms, or therapeutic areas

**Division / Team Context** *(only if inferable from job posting)*
- The specific division, department, or team mentioned in the posting
- Known leadership of that division
- Recent work, publications, or announcements from that team
- How the division fits within the broader company structure

**Scientific / Pipeline Relevance** *(biotech/pharma roles)*
- Active pipeline programs relevant to the role's domain
- Recent publications from company scientists (search PubMed and bioRxiv for company-affiliated authors)
- Key platform technologies or proprietary methods mentioned in public materials
- Clinical trial status if applicable (ClinicalTrials.gov)

**Competitive Landscape**
- Primary competitors in the specific space this role operates in
- How the company differentiates from those competitors publicly
- Any notable recent competitive dynamics (wins, losses, pivots)

**Interview Intelligence**
- Any publicly available information about the company's interview process or culture for this role type (Glassdoor signals, Blind, LinkedIn posts from employees — synthesized, not quoted verbatim)
- Commonly reported values or competencies the company emphasizes in hiring

### Research Brief Output Format

The brief is rendered as a structured report with clearly delineated sections matching the research scope above. Rendered using `react-markdown` (display-only — not TipTap) with a **custom h2/h3 component renderer** that wraps each section heading and its following content in a collapsible accordion container.

**Default state: all sections collapsed.** The user sees section headers only on initial load and expands what they want to read.

The custom renderer intercepts h2/h3 nodes in the markdown tree. Each section is a controlled accordion: clicking the header toggles the body content. The heading level determines nesting depth (h2 = top-level section, h3 = subsection within a section).

At the top of the brief, display:
- Company name and role title
- Research depth selected (Quick / Deep)
- Timestamp of when research was run
- Number of web searches performed (extracted from `SearchEvent` emissions during generation)
- All cited sources as a collapsed "Sources" section at the bottom, listed as clickable URLs (deduplicated if the same URL was returned across multiple searches)

**Export as PDF**: A "Export Brief as PDF" button renders the full expanded report to PDF. The markdown component accepts an `exportMode={true}` prop that suppresses all collapsible behavior — every section renders fully expanded. PDF export uses this stateless `exportMode` render, not the current UI collapse state. Audit the existing PDF export infrastructure before implementation to determine the correct rendering pipeline (Puppeteer or jsPDF). Saved to `[Output Folder]/[Company] — [Job Title] — [YYYY-MM-DD]/InterviewBrief.pdf`.

### Research Generation UX

Research runs in the background — the user can navigate away from the Interview Prep tab while generation is in progress. The tab shows a live status indicator driven by `SearchEvent` emissions (e.g., "Searching for recent news...", "Searching PubMed..."). The mock interview section remains locked until research completes.

When research completes:
- If the user is on the Interview Prep tab: the brief renders in real time and the mock interview section unlocks immediately via React state update — no page action required.
- If the user is on a different tab: show a toast notification: "Research complete for [Job Title]."

### Research Persistence

The full research brief (as markdown string) and metadata (depth, timestamp, sources list, `brief_version`) are saved to SQLite linked to the job ID. `brief_version` is an integer that starts at 1 and increments on each re-run. If a brief already exists for a job, the tab opens directly to the existing brief rather than re-prompting for depth.

The "Re-run Research" button in the brief header allows the user to regenerate (with depth re-selection), which overwrites the previous brief after a confirmation prompt. On re-run:
1. The brief markdown, metadata, and `brief_version` are overwritten.
2. Any past mock interview sessions that were seeded with a previous brief version display a staleness banner: *"The research brief was updated after this session was conducted."* This is detected by comparing the `brief_version` stored on the session row at creation time to the current `brief_version`. A session with `brief_version = null` was conducted with no brief — no staleness banner.

---

## Phase 2: Mock Interview

### Entry Point

The mock interview section is below the research brief. If the job has a **Paused** session, a prominent **"Resume Session"** card appears above the "Start New Session" form, clearly indicating there is an unfinished session and offering a single-click resume. The user can dismiss this card to start a new session instead.

If no paused session exists, the section shows the standard session configuration form:

- **Mode selector** (chosen fresh each session — not persisted as a default):
  - **Live Feedback** — LLM asks one question at a time; after each answer, provides structured feedback before moving to the next question
  - **Full Run** — LLM asks all questions without interruption; debrief and feedback delivered at the end
- **Question category toggles** — checkboxes for which question types to include in this session. All on by default:
  - Behavioral (STAR format)
  - Technical / Domain-specific
  - Culture Fit
  - Role-specific (why this company, why this role)
  - Curveball / Stress questions
  - Questions to Ask the Interviewer *(always included as the final section regardless of other selections)*
- **Estimated question count** — displayed dynamically based on selected categories (e.g., "~12–15 questions"). This is a rough UI estimate only — do not pre-generate the question list. The progress indicator during the session shows only the current question number ("Question 4") with no denominator, since the total is not known upfront.
- **"Begin Session"** button

### Context Injected into Mock Interview System Prompt

When a session begins, the following context is assembled and included in the system prompt:

1. Full job description (from the job record)
2. Tailored resume text for this job (from Tab 1, if generated)
3. Cover letter text for this job (from Tab 2, if generated)
4. Research brief (full text from Phase 1, if available — include a note if not yet generated)
5. Q&A template library entries — filtered to only include templates whose `category` field matches the selected session categories. Templates with `category = null` are always included regardless of selected categories (catch-all). Framed as: *"The following are the user's pre-approved answers to common interview questions. Use these as context for evaluating and coaching their answers, and to inform how you phrase questions — but do not reference them explicitly or tell the user you have them."*
6. User background (master resume text from Settings)

### Interviewer Persona

The LLM plays a professional but realistic interviewer. System prompt instructs:

- Ask one question at a time. Wait for the user's answer before proceeding.
- Vary question phrasing naturally — do not use robotic or formulaic framing
- For behavioral questions, if the user's answer lacks STAR structure (Situation, Task, Action, Result), note this in feedback
- For technical questions, draw from the specific methods, tools, and domain areas mentioned in the job description — do not ask generic science questions
- For curveball questions, be realistic rather than theatrical (e.g., "What's your biggest professional failure?" rather than "How many golf balls fit in a 747?")
- Do not break character during the question-asking phase in Full Run mode
- The final section of every session is "Questions to Ask the Interviewer" — the LLM prompts the user to practice asking interview questions, responds naturally as an interviewer would, and provides feedback

### Session Engines

Live Feedback and Full Run are implemented as **two separate session engine components** with distinct React components and LLM call logic. They share the same TypeScript types and DB layer, but their interaction patterns are architecturally different enough to warrant full separation. No shared branching logic in a single engine.

---

### Live Feedback Engine

After the user submits an answer, a single LLM call returns both feedback and the next question as **structured JSON output**. The JSON schema:

```ts
type LiveFeedbackResponse = {
  feedback: {
    strength: string;        // 1–2 sentences
    improvement: string;     // 1–2 sentences
    suggested_refinement?: string; // optional, 2–4 sentences
  } | null;                  // null for the very first question (no prior answer yet)
  next_question: string | null; // null when session is complete
  session_complete: boolean;
};
```

**Streaming and rendering**: Stream raw tokens to a buffer token-by-token (showing a typing indicator). Parse JSON only when the stream is complete. Animate the rendered result in section by section using a typewriter/reveal effect: Strength fades in and types out, then Improvement, then Suggested Refinement (if present), then the next question appears on the LLM side of the chat.

**Questions to Ask the Interviewer feedback**: This final section uses a **different feedback format**. The LLM evaluates whether the user's question demonstrates research, genuine curiosity, and strategic thinking — not the Strength/Improvement rubric used for interview answers. Prompt the LLM to give 1–2 sentences on whether the question would impress a real interviewer and why.

---

### Full Run Engine

The LLM asks all questions without interruption, without providing feedback between answers. The send button is disabled while the LLM is streaming a question — the user cannot submit the next answer until the current question has fully rendered.

**Questions to Ask the Interviewer**: The LLM asks the user "Now let's practice — what would you ask me?" and conducts the exchange as a real interaction. The LLM responds as an interviewer would to each question the user asks.

**Debrief**: When all answers are collected, the LLM generates a full debrief. This streams into a **dedicated debrief panel** that replaces the chat view. The debrief panel contains a **Debrief | Transcript** tab switcher at the top:
- **Debrief tab** (default): structured report — overall impression (2–3 sentences), per-question feedback in a collapsible list (Strength / Improvement format), Top 3 priority areas, suggested answers for the 2–3 weakest responses
- **Transcript tab**: read-only view of the full Q&A exchange

**Mini-debrief**: If the user clicks "End Session Early" with fewer than 5 answers given, a lighter debrief format is used: same structure, but "Top 3 priority areas" is reduced to "Top 1–2 areas." The LLM still generates per-question feedback for the questions answered.

---

### Session State and Persistence

Every mock interview session is saved to SQLite:

- `session_id`, `job_id`, `timestamp`, `mode`, `categories_selected`
- `brief_version` — the `brief_version` integer from the research brief at session start time (`null` if no brief existed)
- Each exchange: `question_text`, `user_answer_text`, `feedback_json` (Live Feedback mode), `timestamp`
- `session_status`: `in_progress` | `completed` | `paused`
- `debrief_text` (Full Run mode, saved when generated)

**Auto-save**: State is saved to SQLite after every Q&A exchange. The "Pause Session" button is a UI signal — it sets `session_status = paused` — but data is never lost even if the user closes the tab without clicking it.

**Resume**: When resuming a paused session, the LLM context is rebuilt mechanically from the DB: a structured text block listing each prior Q&A pair (`Q1: [question] | Answer: [answer]`, etc.). No LLM call is made at pause time to generate this summary — it is assembled at resume time from the stored exchange rows.

Sessions are viewable in a **"Past Sessions"** collapsible panel below the "Start Mock Interview" section, listed by date. Clicking a past session opens it inline with the same Debrief | Transcript tab switcher. There is no limit on sessions per job.

A **"Save Key Takeaways to Notes"** button at the bottom of any completed session opens a **preview dialog** showing the timestamped summary that will be appended. The user confirms before it is written. Content is appended to the **bottom** of the job's Notes tab (Tab 5), formatted as a timestamped header + bullet list.

---

## Sidebar Shortcut

The sidebar shortcut points to the **last job where the Interview Prep tab was viewed** (not last job opened anywhere in the app). The badge on the sidebar icon reflects only the state of the specific job the shortcut currently points to — if that job has an in-progress or paused session, the badge is shown; if not, no badge. Unfinished sessions on other jobs do not affect the sidebar badge.

---

## Settings Additions

Add the following to the Settings panel under a new **"Interview Prep"** subsection:

- **Research model**: combobox (same pattern as other module model selectors) — defaults to the most capable available model based on configured API keys
- **Default research depth**: Quick / Deep / Always ask (default: Always ask)

---

## Q&A Template Schema Addition

Add a `category` field to the Q&A template schema as part of this feature:

```ts
type QATemplateCategory =
  | 'behavioral'
  | 'technical'
  | 'culture_fit'
  | 'role_specific'
  | 'curveball'
  | null; // null = catch-all, always injected
```

Existing templates in the DB at migration time receive `category = null`. They will always be injected into mock interview sessions regardless of selected categories. The user can categorize them at any time via the Q&A template editor.

---

## Build Notes

- **SearchEvent normalization**: Define a `SearchEvent` type in `llm.ts`. Anthropic provider adapter translates `tool_use` stream blocks (type: `web_search_20250305`) into `SearchEvent`. OpenAI adapter translates its responses API events into `SearchEvent`. The calling Research Brief component subscribes only to the normalized type.

- **Research generation time**: Can be significantly longer than normal LLM calls. Show a live status indicator updated by `SearchEvent` emissions. The user can navigate away — research runs to completion regardless.

- **JSON structured output for Live Feedback**: Use the provider's structured output / response format feature to enforce the `LiveFeedbackResponse` schema. Stream raw tokens with a typing indicator; parse and render only when the stream completes. Animate sections in with a typewriter reveal.

- **Two separate session engines**: `LiveFeedbackSession` and `FullRunSession` are distinct React components with their own state and LLM call logic. They share `InterviewSession`, `InterviewExchange`, and related DB types from `@shared/types`.

- **Brief versioning DB schema**: `interview_briefs` table stores `brief_version INTEGER NOT NULL DEFAULT 1`. `interview_sessions` table stores `brief_version INTEGER` (nullable — null means no brief existed at session start). Increment `brief_version` on every re-run. Staleness banner logic: `session.brief_version !== null && session.brief_version < currentBrief.brief_version`.

- **Collapsible sections**: Custom `components` prop on `<ReactMarkdown>` overrides `h2` and `h3` renderers. Each heading captures subsequent sibling content until the next heading of equal or higher level. In `exportMode`, the custom renderer renders headings and content without accordion wrappers. Pass `exportMode={true}` from the PDF export trigger.

- **PDF export infrastructure**: Audit existing infrastructure before implementation to confirm whether Puppeteer or jsPDF is in use. The export must render the full brief using `exportMode={true}` regardless of current UI collapse state.

- **Mock interview tab badge and sidebar badge**: Show a visual indicator (colored dot or icon) on the Interview Prep tab when `session_status` is `in_progress` or `paused` for the current job. Sidebar badge reflects only the target job's session state.

- **The mock interview chat and research brief are two separate LLM conversation contexts.** Do not share message history between them.
