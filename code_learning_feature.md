# Feature Spec: Code Learning Module

## Overview

The Code Learning module is a guided, project-based coding curriculum built into the Professional Dashboard. It functions as a local Codecademy tailored entirely to the user's background as a biomedical scientist — teaching Python, R, Bash, SQL, and bioinformatics pipeline frameworks through the construction of real, resume-worthy projects. The LLM acts as a coach and explainer, never as a code-writer. The user writes all code in VS Code; the dashboard serves as the curriculum engine, progress tracker, and feedback interface.

The module integrates with VS Code via a companion extension that communicates bidirectionally with the Electron app over a local WebSocket server. This enables the dashboard to receive the user's actual code, provide targeted feedback in context, and track step completion without requiring the user to leave their editor.

---

## Module Placement

The Code Learning module is added as a **top-level sidebar entry** — a sixth icon, positioned below Application Tracker, above the Interview Prep shortcut. It is always visible in the sidebar, regardless of app state (unlike the Interview Prep shortcut, which is conditional). The sidebar icon is a graduation cap or terminal prompt glyph.

The sidebar badge shows the name of the currently active project, truncated. If no project has been started, the badge reads "Start Learning."

---

## Architecture Overview

The module has two top-level states:

**State 1 — Project Selection**: The user has no active project (first launch, or has completed/archived all prior projects). The view presents a project generation flow.

**State 2 — Active Project**: The user is working through a generated curriculum. The view is a two-panel layout: left panel shows the current step's instructions and coaching interface; right panel shows project overview, progress, and session history.

Both states persist fully to SQLite. Switching away from the module and returning always restores the user's exact place.

---

## Phase 1: Project Generation

### Entry Points

A new project can be started from:
- The "Start New Project" button on the Project Selection screen (shown when no active project exists)
- The "Start Another Project" button in the active project header (always accessible; pauses the current project if one is in progress)

### Goal Intake Form

Before any LLM call is made, the user fills out a short intake form. All fields are optional except Language/Tool Target.

**Fields:**

- **What do you want to build or learn?** (free-text, 2–3 sentence prompt) — e.g., "I want to build a Nextflow pipeline that runs differential expression analysis on bulk RNA-seq data" or "I want to get better at writing reproducible R analysis scripts for scRNA-seq"
- **Language / Tool Target** (multi-select chips — required): Python · R · Bash · SQL · Nextflow · Snakemake · Airflow · Mixed
- **Experience level with these tools** (single-select): New to this · Some experience · Comfortable, want depth
- **Estimated time available** (single-select): ~2 hours · Half a day · A few days · A week or more
- **Preferred output artifact** (optional, single-select): CLI tool · Nextflow pipeline · Snakemake workflow · R package · Analysis notebook · Data dashboard · No preference

A **"Surprise me"** button pre-fills the form with a randomly selected bioinformatics project idea appropriate for the selected languages, which the user can edit before generating.

### Project Proposal Generation

On submit, a single LLM call generates a **Project Proposal** — a structured document presenting the project concept for the user to review and accept before a full curriculum is generated. This is not the curriculum itself; it is the pitch.

The proposal LLM call uses the system prompt in the **Teaching LLM Prompt Design** section below. It receives the intake form responses and returns a `ProjectProposal` JSON object:

```ts
type ProjectProposal = {
  title: string;                     // e.g., "Bulk RNA-seq DE Pipeline with Nextflow + DESeq2"
  summary: string;                   // 3–4 sentence description of what will be built
  languages: string[];               // e.g., ["Nextflow", "R", "Bash"]
  estimated_steps: number;           // rough count
  estimated_hours: number;           // total estimated time
  resume_artifact: string;           // e.g., "A complete, parameterized Nextflow pipeline publishable to GitHub"
  prerequisite_installs: string[];   // e.g., ["Nextflow ≥ 24.x", "R ≥ 4.3", "conda or Docker"]
  what_you_will_learn: string[];     // 4–6 bullet points
  why_this_project: string;          // 2–3 sentences on resume/career relevance
};
```

The proposal is rendered as a clean card UI — title prominent, summary paragraph, "What you'll learn" bullet list, prerequisite chips, and a resume relevance blurb. Two buttons: **Start This Project** and **Try a Different Idea** (reruns proposal generation with a brief "try again" note appended to the original prompt).

The user may also click **Edit Details** to revise the intake form before regenerating.

### Curriculum Generation

When the user clicks **Start This Project**, a second LLM call generates the complete curriculum upfront. This call receives the intake form responses, the accepted `ProjectProposal`, and instructions to generate the full step sequence.

**Rationale for upfront generation**: A coherent arc — where early steps scaffold later ones and the project builds to a working artifact — requires the LLM to reason about the whole before specifying the parts. Step-by-step generation is adaptive but risks incoherence and dead ends. Upfront generation is used here with a structured schema that makes individual steps easy to revise or regenerate later if needed.

The curriculum is returned as a `Project` JSON object:

```ts
type Project = {
  id: string;                        // uuid
  title: string;
  summary: string;
  languages: string[];
  resume_artifact: string;
  prerequisite_installs: string[];
  project_folder_path: string | null; // set after user chooses scaffold location
  created_at: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  steps: ProjectStep[];
};

type ProjectStep = {
  id: string;                        // uuid
  project_id: string;
  step_number: number;               // 1-indexed, determines display order
  title: string;                     // e.g., "Step 4: Write the trimming process block"
  objective: string;                 // 1–2 sentences: what the user will accomplish
  context: string;                   // 2–4 paragraphs: concept explanation, relevant docs, why this matters
  instructions: string;              // The actual task: what to write, where, and what it should do
  hints: string[];                   // 3–5 progressive hints, revealed one at a time on demand
  target_file: string | null;        // relative path within project folder, e.g., "main.nf"
  target_function_or_block: string | null; // e.g., "process TRIM_READS" or "fit_model()"
  validation_criteria: string;       // what correct completion looks like (for LLM feedback evaluation)
  estimated_minutes: number;
  status: 'locked' | 'active' | 'submitted' | 'completed';
  completion_method: 'manual' | 'vscode' | null; // how it was marked complete
  completed_at: string | null;
};
```

Steps are generated in full upfront. A typical project has 8–20 steps. The step sequence follows a deliberate arc:

1. **Scaffold** (1–2 steps): Set up project structure, initialize config files, verify installs
2. **Core logic** (majority of steps): Build the main components of the project iteratively
3. **Integration** (1–3 steps): Wire components together, test end-to-end
4. **Polish** (1–2 steps): Add error handling, parameterization, documentation, README

The curriculum JSON is saved to SQLite immediately. Generation is streamed with a live progress indicator. If generation fails partway, the partial curriculum is saved and the user is shown what was generated with an option to regenerate the remaining steps.

### Project Folder Scaffolding

After curriculum generation, the user is prompted to choose a location for the project folder. A native file picker opens, defaulting to `~/Projects/` or a configurable default in Settings.

The Electron main process creates the folder structure based on the `target_file` paths in the generated steps. For example, a Nextflow pipeline project scaffolds:

```
[ProjectName]/
  main.nf
  nextflow.config
  modules/
  bin/
  data/          (empty, gitignored)
  results/       (empty, gitignored)
  README.md      (pre-populated with project title and stub sections)
  .gitignore
```

The scaffolded files are stubs — empty or minimally commented. The user fills them in during the course. A `README.md` is pre-populated with the project title, summary, and a "## Usage" stub. A `.gitignore` is pre-populated with appropriate ignores for the project's language stack.

The `project_folder_path` is saved to SQLite once the folder is created. The VS Code extension uses this path to determine which files to watch.

A **"Open in VS Code"** button appears immediately after scaffolding. Clicking it runs `code [project_folder_path]` via Electron's `shell.openExternal` or a subprocess call.

---

## Phase 2: Active Project — Step-by-Step Learning

### Layout

The active project view is a two-panel layout:

**Left panel (60%)**: The current step — instructions, coaching chat, and feedback. This is the primary working surface.

**Right panel (40%)**: Project overview — step list with completion status, progress bar, estimated time remaining, and a collapsible "Past Sessions" panel.

### Step View (Left Panel)

Each step view has four sections, stacked vertically:

**1. Step Header**
- Step number and title
- Estimated time badge
- Target file and block (if set), shown as a clickable chip that triggers the VS Code extension to open the file at the relevant location
- Completion status indicator

**2. Context + Instructions**
- Context (concept explanation) — rendered as markdown, collapsible with "Read context" toggle. Expanded by default for the first time a step is viewed; collapsed thereafter.
- Instructions — always visible. Plain prose describing exactly what to build in this step.

**3. Hints Panel**
- "Need a hint?" button reveals the first hint. Each subsequent click reveals the next hint in sequence.
- Hints are numbered (Hint 1 of 4, etc.).
- Once all hints are revealed, a softer "Still stuck? Ask the coach" prompt appears — this opens the coaching chat with the current step pre-loaded.
- Hint reveal state is saved to SQLite (so reopening the step doesn't re-hide hints already seen).

**4. Coaching Chat**
- A persistent conversational chat interface below the step instructions.
- The user can ask questions, request clarification, or paste error messages.
- The LLM responds in the context of the current step, the project overall, and the user's stated experience level.
- Full conversation history is maintained per step and persisted to SQLite.
- A **"Review My Code"** button at the top of the chat sends the current file contents from VS Code (via WebSocket) plus the step's `validation_criteria` to the LLM for structured feedback. See Feedback Mechanism below.
- The chat does not replace the coaching interface — it augments it. The step instructions always remain visible above the chat.

### Step Advancement

A step can be marked complete in two ways:

**Via VS Code**: The companion extension adds a "✓ Mark Step Complete" command to the VS Code command palette and a status bar button. Clicking it sends a `step_complete` message over the WebSocket. The dashboard advances to the next step and the right panel's progress updates immediately.

**Via Dashboard**: A "Mark This Step Complete" button at the bottom of the left panel. Used when the user is not using the VS Code extension or has completed a step outside the extension context.

**Step locking**: Steps are linear. Only the current active step is interactive. Future steps are shown in the step list (right panel) with a lock icon and their title, but their content is not rendered until they are active. This prevents the user from skipping ahead while preserving a sense of the full arc.

**No auto-validation**: The system does not attempt to run or lint the user's code to verify correctness. Step completion is intentionally manual — the user (and their coaching conversation with the LLM) determines when a step is done. This keeps the architecture simple, avoids runtime environment dependencies, and matches the coached-learning philosophy.

### Right Panel — Project Overview

- Project title and resume artifact blurb (collapsed, expandable)
- Progress bar: `steps_completed / total_steps`, with percentage
- Step list: all steps shown as a vertical list. Completed steps show a checkmark; active step is highlighted with the accent color; locked steps are dimmed with a lock icon.
- Estimated time remaining (sum of `estimated_minutes` for incomplete steps)
- **"Open in VS Code"** button (always visible)
- **VS Code extension connection status** indicator: green dot "Connected" / gray dot "Not connected." The status reflects whether the WebSocket connection to the extension is currently active.

### Past Sessions Panel (Right Panel, Collapsible)

A collapsible panel below the step list, listing prior coaching chat sessions for this project grouped by date. Clicking a session date expands its summary (step number worked on, number of messages exchanged). Full chat history for any step is accessible by clicking into the step from the step list.

---

## VS Code Extension

### Overview

The VS Code extension is a separate deliverable from the dashboard module — it lives in its own subdirectory of the repository (`/vscode-extension/`) and is packaged as a `.vsix` file for local installation. It is not published to the VS Code Marketplace initially, though the architecture should not preclude it.

The extension connects to the Electron app's local WebSocket server at startup (or when a project folder is opened that matches a known active project path). All communication is over `ws://localhost:[port]` — port is configurable, default `52049`.

### Extension Capabilities

**Outbound (extension → dashboard):**
- `file_contents`: Sends the full text of the currently active file, triggered on explicit user request (via "Review My Code" command or button) or on file save when review-on-save is enabled in Settings.
- `step_complete`: Marks the current step done. Triggered via command palette ("Code Learning: Mark Step Complete") or the status bar button.
- `active_file_changed`: Notifies the dashboard when the user switches to a different file tab. Payload includes the file path relative to the project root.
- `heartbeat`: Sent every 30 seconds to keep the connection alive.

**Inbound (dashboard → extension):**
- `step_updated`: Sent when the active step changes (e.g., after `step_complete`). Payload includes the new step's `target_file` and `target_function_or_block`.
- `open_file`: Requests the extension to open a specific file and optionally scroll to a specific line range or function name.
- `feedback_ready`: Notifies the extension that LLM feedback on submitted code is ready. The extension shows a VS Code notification with a "View Feedback" action that brings the dashboard window to focus.

### VS Code Extension Architecture

The extension activates when VS Code opens a folder matching the `project_folder_path` of any active Code Learning project stored in the dashboard's SQLite DB. To make this check without importing SQLite into the extension, the Electron app writes a small JSON index file at a well-known location:

```
~/.professional-dashboard/active-projects.json
```

This file is updated by the Electron main process whenever a project is created, activated, completed, or archived. The extension reads it at activation time and on file system watch events. If the opened folder path matches an entry in this file, the extension activates and attempts to connect to the WebSocket server.

**Connection management:**
- The extension attempts reconnection with exponential backoff (1s, 2s, 4s, max 30s) if the initial connection fails or drops.
- The status bar item (`$(mortar-board) Code Learning`) is always visible in Code Learning projects. It shows "Connected" (accent color) or "Disconnected" (dimmed) based on WebSocket state.
- Clicking the status bar item shows a quick-pick menu: "Mark Step Complete" / "Review This File" / "Open Dashboard" / "Disconnect."

**"Open Dashboard" action**: Uses `vscode.env.openExternal(vscode.Uri.parse('professional-dashboard://focus'))` — a custom deep link URI that the Electron app registers as a protocol handler. This brings the Electron window to the foreground. Register the protocol in `main.ts` via `app.setAsDefaultProtocolClient('professional-dashboard')`.

### VS Code API Surface Used

- `vscode.workspace.onDidSaveTextDocument` — triggers file content send on save (if review-on-save enabled)
- `vscode.window.activeTextEditor` — reads current file contents
- `vscode.workspace.workspaceFolders` — determines project root for relative path calculation
- `vscode.commands.registerCommand` — registers "Mark Step Complete" and "Review This File" commands
- `vscode.window.createStatusBarItem` — the persistent status bar connection indicator
- `vscode.window.showInformationMessage` — "Feedback ready" notification with "View Feedback" action
- `vscode.workspace.openTextDocument` + `vscode.window.showTextDocument` — used to open files in response to inbound `open_file` messages
- `vscode.window.showQuickPick` — status bar click menu

No proprietary or preview APIs are used. All of the above are stable VS Code extension APIs available since VS Code 1.70+.

### WebSocket Server (Electron Main Process)

The WebSocket server runs in the Electron main process, started when the app launches. It uses the `ws` npm package (already available in Node.js Electron contexts).

```ts
// main.ts (sketch)
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 52049 });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    // Route to IPC → renderer
    mainWindow.webContents.send('vscode-message', msg);
  });
});

// Renderer → main → WebSocket
ipcMain.on('send-to-vscode', (_, msg) => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  });
});
```

The renderer communicates with the WebSocket server via IPC — the React component sends outbound messages via `ipcRenderer.send('send-to-vscode', msg)` and receives inbound messages via `ipcRenderer.on('vscode-message', handler)`.

**Port conflict handling**: On startup, attempt to bind port `52049`. If the port is in use, increment by 1 up to `52059`. Write the bound port to `~/.professional-dashboard/ws-port` so the VS Code extension can read it. The extension checks this file at activation time.

---

## Feedback Mechanism

### Triggering a Review

The user can request a code review at any time during a step by:
1. Clicking **"Review My Code"** in the dashboard coaching chat panel
2. Running **"Code Learning: Review This File"** from the VS Code command palette
3. (Optional, off by default) Automatic review on file save — configurable in Settings

When triggered from option 1 (dashboard), the dashboard requests the current file contents from the VS Code extension via the `file_contents` WebSocket message type. When triggered from option 2 (VS Code), the extension sends `file_contents` immediately.

If the VS Code extension is not connected, the dashboard shows a fallback: a text area where the user can paste their code directly for review.

### LLM Feedback Call

The feedback LLM call is structured as follows. It is a **single, non-streaming call** that returns a `FeedbackResponse` JSON object.

**Context sent to the LLM:**
1. The step's `objective`, `instructions`, and `validation_criteria`
2. The project's `title`, `summary`, and `languages`
3. The user's experience level (from the original intake form)
4. The full contents of the submitted file
5. The step's `target_function_or_block` (if set), with an instruction to focus review on that region while noting any issues elsewhere that would affect it

**Structured output schema:**

```ts
type FeedbackResponse = {
  overall: 'on_track' | 'needs_work' | 'complete';
  summary: string;              // 2–3 sentences: top-level assessment
  strengths: string[];          // 2–3 specific things done well
  issues: FeedbackIssue[];      // 0–N issues found
  next_nudge: string | null;    // 1–2 sentences: what to try next (null if complete)
};

type FeedbackIssue = {
  severity: 'blocking' | 'minor' | 'style';
  description: string;          // 1–3 sentences: what's wrong and why it matters
  hint: string;                 // a nudge toward fixing it, NOT the solution
};
```

`overall: 'complete'` does not auto-advance the step — the user still clicks "Mark Step Complete" themselves. The feedback result may influence that decision, but completion is always intentional.

**No code solutions in feedback**: The system prompt for feedback calls explicitly instructs the LLM never to provide corrected code, complete implementations, or copy-pasteable fixes. It may describe what a correct implementation should do, reference documentation, or ask a leading question. This is enforced at the prompt level.

### Feedback Rendering

Feedback is rendered inline in the coaching chat as a structured card:

- A colored header bar: green (on_track / complete), yellow (needs_work)
- Summary paragraph
- "What's working" section with strengths as bullets
- "Issues" section: blocking issues shown first with a red left border; minor issues with yellow; style notes collapsed under "Style notes" toggle
- "Next step" nudge at the bottom
- A "Request Another Review" button

Feedback cards are stored in the coaching chat history for the current step in SQLite, indistinguishable in storage from regular chat messages (they are stored as `role: 'feedback'` messages with the JSON blob as content).

---

## Teaching LLM Prompt Design

### System Prompt Architecture

All Code Learning LLM calls share a base system prompt that establishes the teaching persona and injects project and user context. Module-specific instructions are appended as a second section.

**Base system prompt (used for all Code Learning calls):**

```
You are a senior software engineer and bioinformatics expert serving as a coding coach for a biomedical scientist learning to write production-quality bioinformatics code. Your student has deep expertise in biology — single-cell RNA sequencing, tumor immunology, spatial transcriptomics — and is developing as a programmer.

Your role is to coach, not to solve. You explain concepts clearly, describe what needs to be built, answer questions, and give feedback on what the student has written. You never provide complete, working code blocks unless the student has made multiple genuine attempts and is genuinely stuck (and even then, only the minimal snippet needed to unblock them, with a clear explanation of why it works).

When explaining concepts, anchor them to biology where possible — the student understands data in terms of cells, genes, samples, and experiments, not abstract data structures. Use those analogies.

The student is working on: {project.title}
Languages and tools: {project.languages.join(', ')}
Experience level: {intake.experience_level}
Current step: Step {step.step_number} — {step.title}
```

**Per-call appended instructions** vary by call type:
- **Project proposal**: Generate the project proposal JSON. No coaching tone needed.
- **Curriculum generation**: Generate the complete step sequence JSON. Reason about the full arc before writing individual steps.
- **Coaching chat**: Conversational reply to the student's question. Draw on current step context.
- **Code feedback**: Structured evaluation per the FeedbackResponse schema. No solutions.
- **Hint generation**: (If hints are regenerated) Generate progressive hints that lead toward the answer without giving it.

### Conversation Management

Each step has its own independent conversation history. When the user moves to a new step, a fresh conversation context begins — the coaching chat for the prior step is saved and browsable but not included in the new step's context window.

**Exception**: When a student asks a question that references a prior step ("This is failing for the same reason as step 3"), the coaching chat includes a summary block of the referenced step's context at the top of the messages array.

The conversation history for each step is stored as `coaching_messages` rows in SQLite (see Schema section). At resume time, the full history is loaded and sent to the LLM as the messages array — no summarization is needed for typical step lengths (usually under 30 exchanges).

For very long coaching sessions (> 40 exchanges), older messages are summarized into a single system-level context block: "Earlier in this step, the student and coach discussed: [summary]." The summary is generated lazily (only when the 40-message threshold is crossed) and cached in SQLite.

---

## Progress Persistence — SQLite Schema

### New Tables

```sql
-- One row per generated project
CREATE TABLE code_learning_projects (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL,
  summary               TEXT NOT NULL,
  languages             TEXT NOT NULL,          -- JSON array
  resume_artifact       TEXT NOT NULL,
  prerequisite_installs TEXT NOT NULL,          -- JSON array
  project_folder_path   TEXT,                   -- null until folder chosen
  intake_form_json      TEXT NOT NULL,          -- full intake form responses
  proposal_json         TEXT NOT NULL,          -- accepted ProjectProposal
  status                TEXT NOT NULL DEFAULT 'active',  -- active|paused|completed|archived
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

-- One row per step, ordered by step_number
CREATE TABLE code_learning_steps (
  id                          TEXT PRIMARY KEY,
  project_id                  TEXT NOT NULL REFERENCES code_learning_projects(id),
  step_number                 INTEGER NOT NULL,
  title                       TEXT NOT NULL,
  objective                   TEXT NOT NULL,
  context                     TEXT NOT NULL,
  instructions                TEXT NOT NULL,
  hints                       TEXT NOT NULL,    -- JSON array of strings
  hints_revealed              INTEGER NOT NULL DEFAULT 0,
  target_file                 TEXT,
  target_function_or_block    TEXT,
  validation_criteria         TEXT NOT NULL,
  estimated_minutes           INTEGER NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'locked',  -- locked|active|submitted|completed
  completion_method           TEXT,             -- manual|vscode|null
  completed_at                TEXT
);

-- Coaching chat messages per step (including feedback cards)
CREATE TABLE code_learning_messages (
  id          TEXT PRIMARY KEY,
  step_id     TEXT NOT NULL REFERENCES code_learning_steps(id),
  role        TEXT NOT NULL,   -- user|assistant|feedback
  content     TEXT NOT NULL,   -- plain text for user/assistant; JSON blob for feedback
  created_at  TEXT NOT NULL
);

-- Cached step-level conversation summary (generated when message count > 40)
CREATE TABLE code_learning_step_summaries (
  step_id     TEXT PRIMARY KEY REFERENCES code_learning_steps(id),
  summary     TEXT NOT NULL,
  summarized_through_message_id TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
```

### Migration

This feature adds four new tables. No existing tables are modified. The migration runs on app launch if these tables do not exist (`CREATE TABLE IF NOT EXISTS`).

### Auto-Save Behavior

- Step status changes (locked → active → completed) are written immediately.
- Coaching chat messages are written immediately after each exchange completes (no buffering).
- Hint reveal state (`hints_revealed` count) is written on each hint reveal.
- Project `updated_at` is bumped on any write to steps or messages within that project.

### Resume Behavior

On app launch, the most recently active project (`status = 'active'` ordered by `updated_at DESC`) is automatically loaded and displayed. The step with `status = 'active'` is restored as the current step. Its full coaching chat history is loaded from `code_learning_messages` and re-rendered.

If the VS Code extension reconnects after a disconnect, the dashboard sends the current step's `target_file` in a `step_updated` message so the extension restores its context.

---

## Nextflow / Snakemake / Airflow Runtime Considerations

### Design Principle

The Code Learning module does not attempt to manage, install, or abstract pipeline framework runtimes. It assumes the user has (or will install) the required tools locally. The module's job is to teach how to write the code correctly — not to provide a runtime sandbox.

This is consistent with how real bioinformatics work is done: the practitioner manages their own environment (conda, Docker, local cluster access). Teaching the user to set up and use these environments is itself part of the curriculum.

### What This Means in Practice

**Step 1 of any pipeline project is always an environment setup step.** The curriculum generates an explicit first step covering:
- Required installs (Nextflow, Java, conda or Docker as appropriate)
- Verification commands (`nextflow -version`, `snakemake --version`, etc.)
- Any test data acquisition (e.g., a small FASTQ pair from SRA for a RNA-seq pipeline)

The `prerequisite_installs` field of the `ProjectProposal` lists all required tools. These are shown to the user on the proposal card before they accept. If the user's stated experience level is "New to this," the first setup step includes more detailed installation context; at higher levels, it references documentation and assumes the user can follow it.

**Docker-based execution** is encouraged over local installs for pipeline frameworks where appropriate — the step instructions will guide users through a Docker-based Nextflow or Snakemake run if the project calls for it. The coaching LLM is instructed to explain Docker concepts in the context of reproducibility (a concept already familiar to scientists from the replication crisis context).

**No automated verification**: The module does not attempt to run `nextflow run main.nf` or check output files. Step completion for pipeline framework steps relies on the coaching chat and manual review — the user pastes error output, log snippets, or describes their result, and the LLM coaches them through it.

### Test Data Strategy

Pipeline projects require real (or realistic) test data. The curriculum generation prompt instructs the LLM to specify small, publicly available datasets appropriate for the project type:

- Bulk RNA-seq: A small subset of a GEO dataset (e.g., first 1M reads of GSE series); alternatively, simulated reads via `polyester` R package
- scRNA-seq: The 10x Genomics PBMC 3k dataset (standard benchmark; well-documented)
- Spatial transcriptomics: Visium FFPE demo dataset from 10x
- Custom: `Step 1: Acquire test data` instructs the user which database, accession, and tool to use

Data download instructions are embedded in the setup step's instructions, not automated by the app. This keeps the module's runtime dependencies minimal.

---

## Settings Additions

Add a new **"Code Learning"** subsection to the Settings panel, positioned after the Interview Prep section:

- **Code Learning model**: Combobox (same pattern as other module model selectors). Defaults to the most capable model available based on configured API keys. This model is used for all Code Learning LLM calls: proposal generation, curriculum generation, coaching chat, and feedback.
- **Ollama endpoint** *(optional, future)*: Text input for a local Ollama server URL (e.g., `http://localhost:11434`). Shown but disabled ("Coming soon") in the initial implementation. The `llm.ts` abstraction layer must not preclude adding an `ollama` provider — add `'ollama'` as a valid provider type in the `Provider` union type from day one, even though it is not implemented. The Settings field being present from the start signals intent and prevents schema migration pain later.
- **Default project folder**: File picker to set the default location for new project scaffolds. Defaults to `~/Projects/`.
- **Review on save**: Toggle (off by default). When enabled, the VS Code extension automatically sends file contents to the dashboard for review on every save event. **Show a warning tooltip**: "This sends your file to the LLM on every save. Disable if you find it disruptive."
- **VS Code extension status**: A read-only indicator showing whether the companion extension is currently connected. A "Copy install instructions" button copies the `.vsix` install command to the clipboard.

---

## Build Notes for Claude Code

- **Project and curriculum generation are two separate LLM calls**, not one. The proposal call is fast (no streaming needed — show a spinner); the curriculum call is slower (stream the raw JSON with a progress indicator showing "Generating step N..."). Parse the curriculum JSON only when the stream completes.

- **Curriculum JSON streaming UX**: During generation, parse the partial stream incrementally to show step titles as they are generated: "Step 1: Set up project structure ✓ / Step 2: Write nextflow.config ✓ / Generating step 3..." This requires streaming into a buffer and scanning for complete `ProjectStep` objects as they appear. Use a simple substring scan for `"step_number": N` boundaries rather than a full streaming JSON parser.

- **JSON structured output**: Use the provider's structured output / response format feature (same pattern as `LiveFeedbackResponse` in Interview Prep) to enforce `ProjectProposal`, `Project`, and `FeedbackResponse` schemas. For providers that do not support structured output natively, append explicit JSON schema instructions to the system prompt and strip any markdown fences before parsing.

- **WebSocket server startup**: Start the WebSocket server in `main.ts` before the browser window is created. Write the bound port to `~/.professional-dashboard/ws-port` immediately after successful bind. The active-projects index file (`~/.professional-dashboard/active-projects.json`) is updated by a dedicated `ActiveProjectsIndex` class in the main process — do not scatter writes to this file across multiple modules.

- **VS Code extension packaging**: The extension lives at `/vscode-extension/` in the repo root. Add a `package.json` script `"package:vscode"` that runs `vsce package` to produce a `.vsix`. The Electron app's Settings panel reads the `.vsix` path from a well-known build output location and offers a "Copy install command" button that puts `code --install-extension [path]` on the clipboard.

- **File contents payload size**: A single source file sent for review is unlikely to exceed reasonable LLM context limits. However, if a file exceeds 500 lines, the dashboard warns: "This file is long. Consider reviewing only the relevant function — use the step's target block as a guide." The warning is advisory only; the user can still submit the full file.

- **The coaching chat and feedback mechanism share the same `code_learning_messages` table** but are distinct UI surfaces. The coaching chat is a freeform exchange; feedback cards are structured inserts. Both are rendered in the same chronological thread — a feedback card appears in-line at the point it was generated, visually distinct (card-style with colored header) from regular chat bubbles.

- **Two separate LLM conversation contexts per step**: The coaching chat maintains a `messages` array in React state (hydrated from SQLite on step load). The feedback call is a one-shot structured call that does not append to the coaching chat's messages array at the API level — its result is stored separately and rendered as a `role: 'feedback'` entry in the UI only.

- **Step list in right panel**: Render all steps on initial project load (from SQLite). Do not re-fetch from the LLM. The full step sequence is the source of truth in SQLite from the moment curriculum generation completes.

- **"Open in VS Code" button**: Use `require('child_process').exec(\`code "${projectFolderPath}"\`)` in the Electron main process (via IPC from renderer). Do not use `shell.openExternal` for this — `code` is a shell command, not a URI. Ensure the button degrades gracefully if `code` is not in PATH (show a toast: "Could not open VS Code. Make sure the `code` command is installed from VS Code's command palette: 'Shell Command: Install code command in PATH'").

- **`llm.ts` additions**: Add `'ollama'` to the `Provider` union type. Add an `experienceLevel` optional parameter to the LLM call interface — this is used by Code Learning calls and ignored by all other modules. This parameter is injected into the base system prompt; it does not change the API call structure.

---

## Implementation Phase

The Code Learning module should be built after Interview Prep (Phase 7), as it shares:
- The session engine pattern (per-step conversation history, resume-from-DB)
- The structured JSON streaming pattern (curriculum generation ↔ research brief generation)
- The `llm.ts` provider abstraction (Ollama addition, structured output)

It introduces two novel infrastructure pieces not present in earlier modules:
1. The local WebSocket server in the Electron main process
2. The VS Code companion extension as a separate build target

Suggested build sequence within Phase 7 (after Interview Prep):

1. **SQLite schema migration** — four new tables
2. **`llm.ts` additions** — Ollama type stub, `experienceLevel` parameter
3. **Project generation flow** — intake form → proposal → curriculum → scaffolding
4. **Active project view** — step navigation, coaching chat, hint system
5. **Feedback mechanism** — `FeedbackResponse` structured call, card rendering
6. **WebSocket server** — Electron main process, IPC bridge to renderer
7. **VS Code extension** — connection, commands, status bar, file send
8. **Settings additions** — model selector, Ollama stub, review-on-save toggle
9. **`active-projects.json` index** — written by main process, read by extension

The VS Code extension (step 7) can be developed in parallel with steps 4–6, as it only requires the WebSocket server (step 6) to be functional to test end-to-end.
