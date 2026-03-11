import { ipcMain, shell, IpcMainEvent } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { IPC } from '../../shared/types'
import type {
  VSCodeMessage,
  CodeLearningIntakeForm,
  ProjectProposal,
  Project,
  ProjectStep,
  FeedbackResponse,
} from '../../shared/types'
import { wsServer } from '../wsServer'
import { getEncryptedKey } from './settings'
import { getDb } from '../db'

// ── JSON helpers ──────────────────────────────────────────────────────────────

function stripJsonFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
}

function parseJson<T>(text: string): T {
  return JSON.parse(stripJsonFences(text)) as T
}

// ── OpenAI JSON Schema objects (for response_format structured outputs) ───────

const PROPOSAL_OPENAI_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    languages: { type: 'array', items: { type: 'string' } },
    estimated_steps: { type: 'integer' },
    estimated_hours: { type: 'number' },
    resume_artifact: { type: 'string' },
    prerequisite_installs: { type: 'array', items: { type: 'string' } },
    what_you_will_learn: { type: 'array', items: { type: 'string' } },
    why_this_project: { type: 'string' },
  },
  required: ['title', 'summary', 'languages', 'estimated_steps', 'estimated_hours',
             'resume_artifact', 'prerequisite_installs', 'what_you_will_learn', 'why_this_project'],
  additionalProperties: false,
}

const FEEDBACK_OPENAI_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    overall: { type: 'string', enum: ['on_track', 'needs_work', 'complete'] },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'minor', 'style'] },
          description: { type: 'string' },
          hint: { type: 'string' },
        },
        required: ['severity', 'description', 'hint'],
        additionalProperties: false,
      },
    },
    next_nudge: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['overall', 'summary', 'strengths', 'issues', 'next_nudge'],
  additionalProperties: false,
}

// ── Prompt builders ───────────────────────────────────────────────────────────

const PROPOSAL_SCHEMA = `{
  "title": "Short, specific project name",
  "summary": "3–4 sentence description of what will be built and why it matters",
  "languages": ["Language1", "Tool2"],
  "estimated_steps": <integer 8–20>,
  "estimated_hours": <number>,
  "resume_artifact": "One sentence describing the concrete deliverable",
  "prerequisite_installs": ["Tool ≥ version"],
  "what_you_will_learn": ["4–6 specific, concrete skills"],
  "why_this_project": "2–3 sentences on resume and career relevance"
}`

const CURRICULUM_SCHEMA = `{
  "title": string,
  "summary": string,
  "languages": string[],
  "resume_artifact": string,
  "prerequisite_installs": string[],
  "steps": [
    {
      "step_number": <1-indexed integer>,
      "title": string,
      "objective": "1–2 sentences: what the student will accomplish",
      "context": "2–4 paragraphs markdown: concept explanation, why it matters, biology analogy where relevant",
      "instructions": "Precise prose: what to write, in which file, what it must accomplish",
      "hints": ["3–5 progressive hints — each narrower than the last, none giving the answer outright"],
      "target_file": "relative/path/to/file.ext or null",
      "target_function_or_block": "function or block identifier, or null",
      "validation_criteria": "What correct completion looks like",
      "estimated_minutes": <integer>
    }
  ]
}`

const FEEDBACK_SCHEMA = `{
  "overall": "on_track" | "needs_work" | "complete",
  "summary": "2–3 sentences: top-level assessment",
  "strengths": ["2–3 specific things done well"],
  "issues": [
    {
      "severity": "blocking" | "minor" | "style",
      "description": "1–3 sentences: what is wrong and why it matters",
      "hint": "A nudge toward fixing it — NOT a solution or corrected code"
    }
  ],
  "next_nudge": "1–2 sentences on what to try next, or null if complete"
}`

const BASE_COACH_PREAMBLE = `You are a senior software engineer and bioinformatics expert serving as a coding coach for a biomedical scientist learning to write production-quality bioinformatics code. Your student has deep expertise in biology — single-cell RNA sequencing, tumor immunology, spatial transcriptomics — and is developing as a programmer.

Your role is to coach, not to solve. You explain concepts clearly, describe what needs to be built, answer questions, and give feedback on what the student has written. You never provide complete, working code blocks unless the student has made multiple genuine attempts and is genuinely stuck (and even then, only the minimal snippet needed to unblock them, with a clear explanation of why it works).

When explaining concepts, anchor them to biology where possible — the student understands data in terms of cells, genes, samples, and experiments, not abstract data structures. Use those analogies.`

function buildProposalSystemPrompt(): string {
  return `You are a senior software engineer and bioinformatics expert. Design a practical, resume-worthy coding project for a biomedical scientist who is developing as a programmer.

The project must:
- Be completable by someone with the stated experience level working alone
- Produce a real artifact the user can share on GitHub or include on a resume
- Teach skills directly applicable to bioinformatics work in academia or biotech
- Align precisely with the languages and tools the user specified

Return ONLY a single valid JSON object. No markdown fences, no text before or after the JSON. Schema:
${PROPOSAL_SCHEMA}`
}

function buildProposalUserMessage(intake: CodeLearningIntakeForm): string {
  return `Generate a project proposal for a biomedical scientist with the following goals and constraints:

Goal: ${intake.goalText || '(not specified)'}
Languages/tools: ${intake.languages.join(', ')}
Experience level: ${intake.experienceLevel}
Time available: ${intake.timeEstimate}
Preferred output artifact: ${intake.outputArtifact}`
}

function buildCurriculumSystemPrompt(): string {
  return `You are a senior software engineer and bioinformatics expert designing a structured project-based coding curriculum.

Before writing individual steps, reason through the complete project arc:
1. Scaffold (1–2 steps): Directory setup, config files, verifying installs and test data
2. Core logic (majority of steps): Build the main project components iteratively, each step scaffolding the next
3. Integration (1–3 steps): Wire all components together, end-to-end pipeline or tool run
4. Polish (1–2 steps): Error handling, parameterization, documentation, README

Each step must have:
- Context: 2–4 paragraphs explaining the underlying concept, why it matters in production bioinformatics, and a biology analogy where applicable
- Instructions: Precise prose — what to write, in which exact file, and what it must accomplish
- Hints: 3–5 progressive hints where each hint narrows the gap without giving the answer

Return ONLY a single valid JSON object. No markdown fences, no text before or after the JSON. Schema:
${CURRICULUM_SCHEMA}`
}

function buildCurriculumUserMessage(intake: CodeLearningIntakeForm, proposal: ProjectProposal): string {
  return `Generate the complete curriculum for this project:

Project: ${proposal.title}
Summary: ${proposal.summary}
Languages: ${proposal.languages.join(', ')}
Resume artifact: ${proposal.resume_artifact}
Prerequisites: ${proposal.prerequisite_installs.join(', ')}

Student profile:
- Goal: ${intake.goalText || '(not specified)'}
- Experience level: ${intake.experienceLevel}
- Time available: ${intake.timeEstimate}

What they will learn: ${proposal.what_you_will_learn.join('; ')}`
}

function buildCoachSystemPrompt(project: Project, step: ProjectStep, experienceLevel: string): string {
  return `${BASE_COACH_PREAMBLE}

The student is working on: ${project.title}
Languages and tools: ${project.languages.join(', ')}
Experience level: ${experienceLevel}
Current step: Step ${step.step_number} — ${step.title}
Step objective: ${step.objective}
Step instructions:
${step.instructions}

Respond conversationally to the student's question. Draw on the current step context. Be concise and encouraging. Do not repeat the step instructions verbatim unless the student seems confused about what to do.`
}

function buildFeedbackSystemPrompt(project: Project, step: ProjectStep, experienceLevel: string): string {
  const targetContext = [
    step.target_file ? `- Target file: ${step.target_file}` : null,
    step.target_function_or_block ? `- Target block: ${step.target_function_or_block}` : null,
  ].filter(Boolean).join('\n')

  return `${BASE_COACH_PREAMBLE}

You are reviewing the student's submitted code for the current step.

CRITICAL CONSTRAINT: Never provide corrected code, complete implementations, or copy-pasteable fixes — not even partial ones. You may describe what a correct implementation should accomplish, reference relevant documentation by name, or ask a leading question. This constraint is absolute and overrides all other instructions.

Step being reviewed:
- Objective: ${step.objective}
- Instructions: ${step.instructions}
- Validation criteria: ${step.validation_criteria}
${targetContext}

Project context:
- Project: ${project.title}
- Languages: ${project.languages.join(', ')}
- Student experience level: ${experienceLevel}

Return ONLY a single valid JSON object. No markdown fences, no text before or after the JSON. Schema:
${FEEDBACK_SCHEMA}`
}

// ── Step scanning (for incremental curriculum progress) ───────────────────────

interface StepPreview { step_number: number; title: string }

function scanForNewSteps(buffer: string, lastEmitted: number): StepPreview[] {
  const results: StepPreview[] = []
  const stepNumRe = /"step_number"\s*:\s*(\d+)/g
  const titleRe = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/
  let m: RegExpExecArray | null
  while ((m = stepNumRe.exec(buffer)) !== null) {
    const num = parseInt(m[1], 10)
    if (num <= lastEmitted) continue
    const segment = buffer.slice(m.index, m.index + 500)
    const tm = titleRe.exec(segment)
    if (tm) results.push({ step_number: num, title: tm[1] })
  }
  return results
}

// ── Curriculum assembly ───────────────────────────────────────────────────────

function assembleCurriculum(
  raw: Record<string, unknown>,
  proposal: ProjectProposal,
): Project {
  const projectId = randomUUID()
  const rawSteps = Array.isArray(raw.steps) ? raw.steps as Array<Record<string, unknown>> : []

  const steps: ProjectStep[] = rawSteps.map((s, i) => ({
    id: randomUUID(),
    project_id: projectId,
    step_number: typeof s.step_number === 'number' ? s.step_number : i + 1,
    title: String(s.title ?? ''),
    objective: String(s.objective ?? ''),
    context: String(s.context ?? ''),
    instructions: String(s.instructions ?? ''),
    hints: Array.isArray(s.hints) ? s.hints.map(String) : [],
    target_file: typeof s.target_file === 'string' ? s.target_file : null,
    target_function_or_block: typeof s.target_function_or_block === 'string' ? s.target_function_or_block : null,
    validation_criteria: String(s.validation_criteria ?? ''),
    estimated_minutes: typeof s.estimated_minutes === 'number' ? s.estimated_minutes : 30,
    status: i === 0 ? 'active' : 'locked',
    completion_method: null,
    completed_at: null,
  }))

  return {
    id: projectId,
    title: String(raw.title ?? proposal.title),
    summary: String(raw.summary ?? proposal.summary),
    languages: Array.isArray(raw.languages) ? raw.languages.map(String) : proposal.languages,
    resume_artifact: String(raw.resume_artifact ?? proposal.resume_artifact),
    prerequisite_installs: Array.isArray(raw.prerequisite_installs)
      ? raw.prerequisite_installs.map(String)
      : proposal.prerequisite_installs,
    project_folder_path: null,
    created_at: new Date().toISOString(),
    status: 'active',
    steps,
  }
}

// ── LLM call wrappers ─────────────────────────────────────────────────────────

type Msg = { role: 'user' | 'assistant'; content: string }

async function callAnthropicOnce(apiKey: string, model: string, messages: Msg[], system: string, maxTokens = 4096): Promise<string> {
  const client = new Anthropic({ apiKey })
  const resp = await client.messages.create({ model, max_tokens: maxTokens, system, messages })
  return resp.content[0].type === 'text' ? resp.content[0].text : ''
}

async function callOpenAIOnce(
  apiKey: string,
  model: string,
  messages: Msg[],
  system: string,
  maxTokens = 4096,
  jsonSchema?: { name: string; schema: Record<string, unknown> },
): Promise<string> {
  const client = new OpenAI({ apiKey })
  const resp = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, ...messages],
    ...(jsonSchema
      ? { response_format: { type: 'json_schema' as const, json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.schema } } }
      : {}),
  })
  return resp.choices[0]?.message?.content ?? ''
}

async function streamAnthropic(apiKey: string, model: string, messages: Msg[], system: string, onToken: (t: string) => void, maxTokens = 8192): Promise<void> {
  const client = new Anthropic({ apiKey })
  const stream = client.messages.stream({ model, max_tokens: maxTokens, system, messages })
  for await (const evt of stream) {
    if (evt.type === 'content_block_delta' && evt.delta.type === 'text_delta') {
      onToken(evt.delta.text)
    }
  }
}

async function streamOpenAI(apiKey: string, model: string, messages: Msg[], system: string, onToken: (t: string) => void, maxTokens = 8192): Promise<void> {
  const client = new OpenAI({ apiKey })
  const stream = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    stream: true,
    messages: [{ role: 'system', content: system }, ...messages],
  })
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content ?? ''
    if (token) onToken(token)
  }
}

// ── DB row mappers ────────────────────────────────────────────────────────────

function rowToStep(s: Record<string, unknown>): ProjectStep {
  return {
    id: s.id as string,
    project_id: s.project_id as string,
    step_number: s.step_number as number,
    title: s.title as string,
    objective: s.objective as string,
    context: s.context as string,
    instructions: s.instructions as string,
    hints: JSON.parse((s.hints as string) || '[]'),
    target_file: s.target_file as string | null,
    target_function_or_block: s.target_function_or_block as string | null,
    validation_criteria: s.validation_criteria as string,
    estimated_minutes: s.estimated_minutes as number,
    status: s.status as ProjectStep['status'],
    completion_method: s.completion_method as ProjectStep['completion_method'],
    completed_at: s.completed_at as string | null,
  }
}

// ── Handler registration ──────────────────────────────────────────────────────

export function registerCodeLearningHandlers(): void {

  // ── Existing: file ops ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.CODE_LEARNING_OPEN_IN_VSCODE, async (_evt, folderPath: string) => {
    if (!folderPath) return { ok: false, error: 'No folder path provided' }
    try {
      const err = await shell.openPath(folderPath)
      if (err) return { ok: false, error: err }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IPC.CODE_LEARNING_SCAFFOLD_PROJECT, async (_evt, folderPath: string) => {
    if (!folderPath) return { ok: false, error: 'No folder path provided' }
    try {
      for (const sub of ['modules', 'conf', 'bin', 'data', 'results']) {
        mkdirSync(`${folderPath}/${sub}`, { recursive: true })
      }
      writeFileSync(`${folderPath}/.professional-dashboard-project`, '', 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(
    IPC.CODE_LEARNING_UPDATE_ACTIVE_PROJECTS,
    (_evt, projects: Array<{ id: string; folderPath: string | null; activeStepId: string | null; targetFile: string | null }>) => {
      wsServer.updateActiveProjects(projects)
      for (const p of projects) {
        const msg: VSCodeMessage = {
          type: 'step_context',
          stepId: p.activeStepId ?? '',
          targetFile: p.targetFile,
          targetFunctionOrBlock: null,
        }
        if (p.activeStepId) wsServer.broadcast(msg)
      }
      return { ok: true }
    }
  )

  ipcMain.handle(IPC.CODE_LEARNING_UPDATE_PROJECT_FOLDER, (_evt, projectId: string, folderPath: string) => {
    const db = getDb()
    db.prepare(`UPDATE code_learning_projects SET project_folder_path = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(folderPath, projectId)
    return { ok: true }
  })

  // ── LLM: generate-proposal ─────────────────────────────────────────────────

  ipcMain.handle(IPC.CODE_LEARNING_GENERATE_PROPOSAL, async (_evt, payload: {
    intake: CodeLearningIntakeForm
    model: string
    provider: 'anthropic' | 'openai'
  }) => {
    const apiKey = getEncryptedKey(payload.provider === 'anthropic' ? 'anthropicKey' : 'openaiKey')
    if (!apiKey) throw new Error(`No ${payload.provider} API key configured. Please add your key in Settings.`)

    const system = buildProposalSystemPrompt()
    const userMsg = buildProposalUserMessage(payload.intake)
    const messages: Msg[] = [{ role: 'user', content: userMsg }]

    const text = payload.provider === 'anthropic'
      ? await callAnthropicOnce(apiKey, payload.model, messages, system)
      : await callOpenAIOnce(apiKey, payload.model, messages, system, 4096,
          { name: 'project_proposal', schema: PROPOSAL_OPENAI_SCHEMA })

    return parseJson<ProjectProposal>(text)
  })

  // ── LLM: generate-curriculum (streaming) ──────────────────────────────────

  ipcMain.on(IPC.CODE_LEARNING_GENERATE_CURRICULUM, async (event: IpcMainEvent, payload: {
    intake: CodeLearningIntakeForm
    proposal: ProjectProposal
    model: string
    provider: 'anthropic' | 'openai'
  }) => {
    const sender = event.sender
    const apiKey = getEncryptedKey(payload.provider === 'anthropic' ? 'anthropicKey' : 'openaiKey')
    if (!apiKey) {
      sender.send('code-learning:curriculum-error', `No ${payload.provider} API key configured.`)
      return
    }

    const system = buildCurriculumSystemPrompt()
    const userMsg = buildCurriculumUserMessage(payload.intake, payload.proposal)
    const messages: Msg[] = [{ role: 'user', content: userMsg }]

    let buffer = ''
    let lastStepEmitted = 0

    const onToken = (token: string): void => {
      buffer += token
      sender.send('code-learning:curriculum-chunk', token)
      const newSteps = scanForNewSteps(buffer, lastStepEmitted)
      for (const s of newSteps) {
        sender.send('code-learning:step-ready', s)
        lastStepEmitted = Math.max(lastStepEmitted, s.step_number)
      }
    }

    try {
      if (payload.provider === 'anthropic') {
        await streamAnthropic(apiKey, payload.model, messages, system, onToken, 16000)
      } else {
        await streamOpenAI(apiKey, payload.model, messages, system, onToken, 16000)
      }

      const raw = parseJson<Record<string, unknown>>(buffer)
      const project = assembleCurriculum(raw, payload.proposal)
      sender.send('code-learning:curriculum-done', project)
    } catch (err) {
      sender.send('code-learning:curriculum-error', String(err))
    }
  })

  // ── LLM: coaching-message (streaming) ──────────────────────────────────────

  ipcMain.on(IPC.CODE_LEARNING_COACHING_MESSAGE, async (event: IpcMainEvent, payload: {
    step: ProjectStep
    project: Project
    history: Msg[]
    userMessage: string
    experienceLevel: string
    model: string
    provider: 'anthropic' | 'openai'
  }) => {
    const sender = event.sender
    const apiKey = getEncryptedKey(payload.provider === 'anthropic' ? 'anthropicKey' : 'openaiKey')
    if (!apiKey) {
      sender.send('code-learning:coaching-error', `No ${payload.provider} API key configured.`)
      return
    }

    const system = buildCoachSystemPrompt(payload.project, payload.step, payload.experienceLevel)
    const messages: Msg[] = [
      ...payload.history,
      { role: 'user', content: payload.userMessage },
    ]

    let fullContent = ''
    const onToken = (token: string): void => {
      fullContent += token
      sender.send('code-learning:coaching-chunk', token)
    }

    try {
      if (payload.provider === 'anthropic') {
        await streamAnthropic(apiKey, payload.model, messages, system, onToken)
      } else {
        await streamOpenAI(apiKey, payload.model, messages, system, onToken)
      }
      sender.send('code-learning:coaching-done', { content: fullContent })
    } catch (err) {
      sender.send('code-learning:coaching-error', String(err))
    }
  })

  // ── LLM: review-code ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.CODE_LEARNING_REVIEW_CODE, async (_evt, payload: {
    step: ProjectStep
    project: Project
    fileContent: string
    experienceLevel: string
    model: string
    provider: 'anthropic' | 'openai'
  }) => {
    const apiKey = getEncryptedKey(payload.provider === 'anthropic' ? 'anthropicKey' : 'openaiKey')
    if (!apiKey) throw new Error(`No ${payload.provider} API key configured. Please add your key in Settings.`)

    const system = buildFeedbackSystemPrompt(payload.project, payload.step, payload.experienceLevel)
    const targetNote = payload.step.target_function_or_block
      ? `Focus your review on \`${payload.step.target_function_or_block}\` while noting any issues elsewhere that would affect it.`
      : ''
    const userMsg = `Review my code for Step ${payload.step.step_number}: ${payload.step.title}
File: ${payload.step.target_file ?? '(active file)'}
${targetNote}

\`\`\`
${payload.fileContent}
\`\`\``

    const messages: Msg[] = [{ role: 'user', content: userMsg }]
    const text = payload.provider === 'anthropic'
      ? await callAnthropicOnce(apiKey, payload.model, messages, system)
      : await callOpenAIOnce(apiKey, payload.model, messages, system, 4096,
          { name: 'feedback_response', schema: FEEDBACK_OPENAI_SCHEMA })

    return parseJson<FeedbackResponse>(text)
  })

  // ── Status: get-ws-status ──────────────────────────────────────────────────

  ipcMain.handle(IPC.CODE_LEARNING_GET_WS_STATUS, () => ({
    connected: wsServer.connectedCount > 0,
  }))

  // ── DB: get-active-project ─────────────────────────────────────────────────

  ipcMain.handle(IPC.CODE_LEARNING_GET_ACTIVE_PROJECT, () => {
    const db = getDb()
    const projectRow = db.prepare(`
      SELECT * FROM code_learning_projects
      WHERE status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get() as Record<string, unknown> | undefined

    if (!projectRow) return null

    const projectId = projectRow.id as string
    const stepRows = db.prepare(`
      SELECT * FROM code_learning_steps
      WHERE project_id = ?
      ORDER BY step_number ASC
    `).all(projectId) as Array<Record<string, unknown>>

    const activeStep = stepRows.find(s => s.status === 'active')
    const messageRows = activeStep
      ? db.prepare(`
          SELECT * FROM code_learning_messages
          WHERE step_id = ?
          ORDER BY created_at ASC
        `).all(activeStep.id as string) as Array<Record<string, unknown>>
      : []

    // Build CoachMessage array (user/assistant as-is; feedback rows parsed from JSON content)
    const activeStepMessages = messageRows.map(m => {
      if (m.role === 'feedback') {
        return {
          id: m.id as string,
          role: 'feedback' as const,
          feedback: JSON.parse(m.content as string) as FeedbackResponse,
        }
      }
      return {
        id: m.id as string,
        role: m.role as 'user' | 'assistant',
        content: m.content as string,
      }
    })

    // hints_revealed map: { stepId → count }
    const hintsRevealed: Record<string, number> = {}
    for (const s of stepRows) {
      if ((s.hints_revealed as number) > 0) {
        hintsRevealed[s.id as string] = s.hints_revealed as number
      }
    }

    const project: Project = {
      id: projectId,
      title: projectRow.title as string,
      summary: projectRow.summary as string,
      languages: JSON.parse(projectRow.languages as string),
      resume_artifact: projectRow.resume_artifact as string,
      prerequisite_installs: JSON.parse(projectRow.prerequisite_installs as string),
      project_folder_path: projectRow.project_folder_path as string | null,
      created_at: projectRow.created_at as string,
      status: projectRow.status as Project['status'],
      steps: stepRows.map(rowToStep),
    }

    // Write active-projects.json immediately so the VS Code extension sees
    // the current state on connect, even before the renderer mounts.
    wsServer.updateActiveProjects([{
      id: project.id,
      folderPath: project.project_folder_path,
      activeStepId: activeStep ? (activeStep.id as string) : null,
      targetFile: activeStep ? (activeStep.target_file as string | null) : null,
    }])

    return { project, activeStepMessages, hintsRevealed }
  })

  // ── DB: save-project ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.CODE_LEARNING_SAVE_PROJECT, (_evt, payload: {
    project: Project
    intake: CodeLearningIntakeForm
    proposal: ProjectProposal
  }) => {
    const db = getDb()
    db.transaction(() => {
      db.prepare(`
        INSERT INTO code_learning_projects
          (id, title, summary, languages, resume_artifact, prerequisite_installs,
           project_folder_path, intake_form_json, proposal_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        payload.project.id,
        payload.project.title,
        payload.project.summary,
        JSON.stringify(payload.project.languages),
        payload.project.resume_artifact,
        JSON.stringify(payload.project.prerequisite_installs),
        payload.project.project_folder_path,
        JSON.stringify(payload.intake),
        JSON.stringify(payload.proposal),
        payload.project.status,
        payload.project.created_at,
        payload.project.created_at,
      )

      for (const step of payload.project.steps) {
        db.prepare(`
          INSERT INTO code_learning_steps
            (id, project_id, step_number, title, objective, context, instructions,
             hints, hints_revealed, target_file, target_function_or_block,
             validation_criteria, estimated_minutes, status, completion_method, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          step.id,
          step.project_id,
          step.step_number,
          step.title,
          step.objective,
          step.context,
          step.instructions,
          JSON.stringify(step.hints),
          step.target_file,
          step.target_function_or_block,
          step.validation_criteria,
          step.estimated_minutes,
          step.status,
          step.completion_method,
          step.completed_at,
        )
      }
    })()
    return { ok: true }
  })

  // ── DB: update-step ────────────────────────────────────────────────────────

  ipcMain.handle(IPC.CODE_LEARNING_UPDATE_STEP, (_evt, payload: {
    stepId: string
    projectId: string
    status: ProjectStep['status']
    completion_method?: ProjectStep['completion_method']
    completed_at?: string | null
  }) => {
    const db = getDb()
    db.prepare(`
      UPDATE code_learning_steps
      SET status = ?, completion_method = ?, completed_at = ?
      WHERE id = ?
    `).run(
      payload.status,
      payload.completion_method ?? null,
      payload.completed_at ?? null,
      payload.stepId,
    )
    db.prepare(`UPDATE code_learning_projects SET updated_at = datetime('now') WHERE id = ?`)
      .run(payload.projectId)
    return { ok: true }
  })

  // ── DB: save-message ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.CODE_LEARNING_SAVE_MESSAGE, (_evt, payload: {
    id: string
    stepId: string
    projectId: string
    role: 'user' | 'assistant' | 'feedback'
    content: string
  }) => {
    const db = getDb()
    db.prepare(`
      INSERT OR IGNORE INTO code_learning_messages (id, step_id, role, content, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(payload.id, payload.stepId, payload.role, payload.content)
    db.prepare(`UPDATE code_learning_projects SET updated_at = datetime('now') WHERE id = ?`)
      .run(payload.projectId)
    return { ok: true }
  })

  // ── DB: update-hints ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.CODE_LEARNING_UPDATE_HINTS, (_evt, payload: {
    stepId: string
    projectId: string
    hintsRevealed: number
  }) => {
    const db = getDb()
    db.prepare(`UPDATE code_learning_steps SET hints_revealed = ? WHERE id = ?`)
      .run(payload.hintsRevealed, payload.stepId)
    db.prepare(`UPDATE code_learning_projects SET updated_at = datetime('now') WHERE id = ?`)
      .run(payload.projectId)
    return { ok: true }
  })

  // ── DB: get-step-messages ──────────────────────────────────────────────────

  ipcMain.handle(IPC.CODE_LEARNING_GET_STEP_MESSAGES, (_evt, stepId: string) => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM code_learning_messages WHERE step_id = ? ORDER BY created_at ASC
    `).all(stepId) as Array<Record<string, unknown>>

    return rows.map(m => {
      if (m.role === 'feedback') {
        return { id: m.id, role: 'feedback' as const, feedback: JSON.parse(m.content as string) as FeedbackResponse }
      }
      return { id: m.id, role: m.role as 'user' | 'assistant', content: m.content as string }
    })
  })
}
