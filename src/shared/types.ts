// ─── LLM ────────────────────────────────────────────────────────────────────

export type LLMProvider = 'anthropic' | 'openai' | 'ollama'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface LLMRequest {
  provider: LLMProvider
  model: string
  messages: ChatMessage[]
  systemPrompt: string
  experienceLevel?: string  // Code Learning only; injected into system prompt if present
}

export interface SearchEvent {
  type: 'search_start' | 'search_complete'
  query: string | null
  provider: 'anthropic' | 'openai'
}

export interface LLMResponse {
  content: string
  inputTokens?: number
  outputTokens?: number
}

// ─── Settings ───────────────────────────────────────────────────────────────

export interface AppSettings {
  anthropicKey: string
  openaiKey: string
  pubmedKey: string
  outputFolder: string
  exportNamePrefix: string
  resumeLayoutPreset: 'ats_standard' | 'ats_compact' | 'ats_detailed'
  dbPath: string
  imapHost: string
  imapPort: number
  imapUser: string
  imapPass: string
  imapTls: boolean
  imapForwardingAddress: string
  linkedinPartition: string
  interviewResearchDepth: 'quick' | 'deep' | 'always_ask'
  codeLearningProjectFolder: string
  codeLearningReviewOnSave: boolean
  codeLearningOllamaEndpoint: string
  models: {
    postGenerator: string
    paperDiscovery: string
    resumeGenerator: string
    coverLetterGenerator: string
    qaGenerator: string
    interviewResearch: string
    codeLearning: string
  }
}

export interface ResumeBase {
  id: number
  name: string
  content: string
  format: 'docx' | 'pdf' | 'text'
  docType: 'resume' | 'cv'
  lockedSections: string[]
  sourceFileName?: string
  sourceFilePath?: string
  activeVersion: number
  createdAt: string
  updatedAt: string
}

export interface ResumeBaseVersion {
  id: number
  baseId: number
  versionNumber: number
  content: string
  format: 'docx' | 'pdf' | 'text'
  sourceFileName?: string
  sourceFilePath?: string
  createdAt: string
}

// ─── Post Generator ──────────────────────────────────────────────────────────

export interface PostSource {
  id: string
  role: 'primary' | 'context'
  type: 'url' | 'text'
  url?: string
  text?: string
  preview?: {
    title: string
    authors: string
    journal: string
    abstract: string
  }
  isFetching?: boolean
}

export interface PostSession {
  id: number
  title?: string
  sources: PostSource[]
  // Legacy fields — kept for backward-compat reading
  sourceUrl?: string
  sourceText?: string
  paperTitle?: string
  paperAuthors?: string
  paperJournal?: string
  paperAbstract?: string
  currentPost: string
  messages: ChatMessage[]
  wordCount: number
  createdAt: string
  updatedAt: string
}

// ─── Paper Discovery ─────────────────────────────────────────────────────────

export interface SearchProfile {
  id: number
  name: string
  keywords: string[]
  meshTerms: string[]
  authors: string[]
  journals: string[]
  createdAt: string
}

export interface Paper {
  id: number
  pmid?: string
  doi?: string
  title: string
  authors: string
  journal: string
  year: number
  abstract: string
  pdfPath?: string
  impactFactor?: number
  altmetricScore?: number
  trendingTier?: 'hot' | 'rising' | 'normal'
  profileIds: number[]
  profileNames: string[]
  isRead: boolean
  isStarred: boolean
  source: 'pubmed' | 'biorxiv' | 'medrxiv' | 'manual'
  addedAt: string
  publishedAt: string
}

// ─── Job Search ──────────────────────────────────────────────────────────────

export type JobStatus =
  | 'needs_enrichment'
  | 'enrichment_failed'
  | 'no_response'
  | 'positive_email'
  | 'positive_interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'

export interface Job {
  id: number
  company: string
  title: string
  location?: string
  remote?: 'remote' | 'hybrid' | 'onsite'
  url?: string
  description?: string
  salary?: string
  jobType?: string
  seniorityLevel?: string
  numApplicants?: number
  easyApply?: boolean
  status: JobStatus
  source: string
  appliedAt?: string
  salaryRange?: string
  applicationSource?: string
  logoUrl?: string
  companyResearch?: string
  addedAt: string
  updatedAt: string
}

export interface ApplicationMaterial {
  id: number
  jobId: number
  type: 'resume' | 'cover_letter' | 'recruiter_message'
  content: string
  messages: ChatMessage[]
  baseResumeId?: number
  exportedDocxPath?: string
  exportedPdfPath?: string
  createdAt: string
  updatedAt: string
}

export type ResumeCompareRowSideStatus = 'empty' | 'unchanged' | 'removed' | 'api' | 'manual'
export type ResumeCompareLineKind = 'name' | 'contact' | 'heading' | 'bullet' | 'paragraph'

export interface ResumeCompareWordToken {
  text: string
  changed: boolean
}

export interface ResumeCompareAnnotatedRow {
  key: string
  kind: ResumeCompareLineKind
  baseTokens: ResumeCompareWordToken[]
  insertedTokens: ResumeCompareWordToken[]
  insertedStatus: ResumeCompareRowSideStatus
  insertionOnly: boolean
}

export interface ResumeCompareStats {
  api: number
  manual: number
  removed: number
  unchanged: number
}

export interface ResumeCompareWindowPayload {
  jobId: number
  company: string
  jobTitle: string
  baseResumeName: string
  hasBaseContent: boolean
  hasCompareRows: boolean
  rows: ResumeCompareAnnotatedRow[]
  stats: ResumeCompareStats
}

export interface ResumeCompareWindowState {
  open: boolean
}

export type QATemplateCategory = 'behavioral' | 'technical' | 'culture_fit' | 'role_specific' | 'curveball' | null

export interface QAEntry {
  id: number
  jobId: number
  question: string
  answer: string
  charLimit?: number
  isTemplate: boolean
  templateName?: string
  category: QATemplateCategory
  createdAt: string
}

// ─── Interview Prep ───────────────────────────────────────────────────────────

export interface InterviewBrief {
  id: number
  jobId: number
  depth: 'quick' | 'deep'
  content: string
  sources: string[]
  searchCount: number
  briefVersion: number
  partial: boolean
  createdAt: string
  updatedAt: string
}

export type InterviewMode = 'live_feedback' | 'full_run'
export type InterviewSessionStatus = 'in_progress' | 'paused' | 'completed'
export type InterviewCategory =
  | 'behavioral'
  | 'technical'
  | 'culture_fit'
  | 'role_specific'
  | 'curveball'
  | 'questions_to_ask'

export interface InterviewSession {
  id: number
  jobId: number
  mode: InterviewMode
  categories: InterviewCategory[]
  briefVersion: number | null
  status: InterviewSessionStatus
  debriefText?: string
  createdAt: string
  updatedAt: string
}

export interface InterviewExchange {
  id: number
  sessionId: number
  sequence: number
  questionText: string
  answerText: string
  feedbackJson?: string
  createdAt: string
}

export interface LiveFeedbackBlock {
  strength: string
  improvement: string
  suggestedRefinement?: string
}

export interface LiveFeedbackResponse {
  feedback: LiveFeedbackBlock | null
  nextQuestion: string | null
  sessionComplete: boolean
  questionType?: InterviewCategory
}

export interface JobNote {
  id: number
  jobId: number
  content: string
  updatedAt: string
}

// ─── Application Tracker ─────────────────────────────────────────────────────

export interface TrackerEntry {
  id: number
  jobId: number
  company: string
  title: string
  location?: string
  remote?: string
  salary?: string
  appliedAt: string
  source: string
  status: JobStatus
  notes?: string
  lastUpdated: string
}

// ─── Code Learning ───────────────────────────────────────────────────────────

export interface CodeLearningIntakeForm {
  goalText: string
  languages: string[]                   // at least one required
  experienceLevel: 'new' | 'some' | 'comfortable'
  timeEstimate: '2h' | 'half_day' | 'few_days' | 'week_plus'
  outputArtifact:
    | 'cli_tool'
    | 'nextflow_pipeline'
    | 'snakemake_workflow'
    | 'r_package'
    | 'analysis_notebook'
    | 'data_dashboard'
    | 'no_preference'
}

export type ProjectProposal = {
  title: string
  summary: string
  languages: string[]
  estimated_steps: number
  estimated_hours: number
  resume_artifact: string
  prerequisite_installs: string[]
  what_you_will_learn: string[]
  why_this_project: string
}

export type ProjectStep = {
  id: string
  project_id: string
  step_number: number
  title: string
  objective: string
  context: string
  instructions: string
  hints: string[]
  target_file: string | null
  target_function_or_block: string | null
  validation_criteria: string
  estimated_minutes: number
  status: 'locked' | 'active' | 'submitted' | 'completed'
  completion_method: 'manual' | 'vscode' | null
  completed_at: string | null
}

export type Project = {
  id: string
  title: string
  summary: string
  languages: string[]
  resume_artifact: string
  prerequisite_installs: string[]
  project_folder_path: string | null
  created_at: string
  status: 'active' | 'paused' | 'completed' | 'archived'
  steps: ProjectStep[]
}

export type FeedbackIssue = {
  severity: 'blocking' | 'minor' | 'style'
  description: string   // 1–3 sentences: what's wrong and why it matters
  hint: string          // nudge toward fixing it, NOT the solution
}

export type FeedbackResponse = {
  overall: 'on_track' | 'needs_work' | 'complete'
  summary: string       // 2–3 sentences: top-level assessment
  strengths: string[]   // 2–3 specific things done well
  issues: FeedbackIssue[]
  next_nudge: string | null  // 1–2 sentences on what to try next; null if complete
}

// ─── VS Code WebSocket Messages ──────────────────────────────────────────────
// Discriminated union covering all messages exchanged over the WebSocket bridge.
// Extension → Electron messages use the 'from' field to route in the main process.

export type VSCodeMessage =
  // Extension → Electron: extension came online with active project context
  | { type: 'hello'; projectId: string; folderPath: string }
  // Extension → Electron: user completed a step in the editor
  | { type: 'step_complete'; projectId: string; stepId: string; completionMethod: 'vscode' }
  // Extension → Electron: file contents for code review
  | { type: 'file_contents'; projectId: string; stepId: string; filePath: string; content: string }
  // Extension → Electron: extension disconnecting cleanly
  | { type: 'goodbye'; projectId: string }
  // Electron → Extension: acknowledge hello, send current step context
  | { type: 'ack'; activeStepId: string | null; targetFile: string | null }
  // Electron → Extension: push updated step context when user navigates
  | { type: 'step_context'; stepId: string; targetFile: string | null; targetFunctionOrBlock: string | null }
  // Electron → Extension: request file contents for a specific path
  | { type: 'request_file'; stepId: string; filePath: string }

// ─── IPC Channel Names ───────────────────────────────────────────────────────

export const IPC = {
  // Settings
  GET_SETTINGS: 'settings:get',
  SET_SETTINGS: 'settings:set',
  GET_API_KEY: 'settings:getApiKey',
  SET_API_KEY: 'settings:setApiKey',
  GET_RESUME_BASES: 'resume:getBases',
  SAVE_RESUME_BASE: 'resume:saveBase',
  DELETE_RESUME_BASE: 'resume:deleteBase',
  GET_RESUME_BASE_VERSIONS: 'resume:getBaseVersions',
  RESTORE_RESUME_BASE_VERSION: 'resume:restoreBaseVersion',
  PARSE_RESUME_FILE: 'resume:parseFile',

  // LLM
  LLM_CALL: 'llm:call',

  // Post Generator
  POST_GET_SESSIONS: 'post:getSessions',
  POST_GET_SESSION: 'post:getSession',
  POST_SAVE_SESSION: 'post:saveSession',
  POST_DELETE_SESSION: 'post:deleteSession',
  POST_FETCH_URL: 'post:fetchUrl',
  POST_PARSE_PDF: 'post:parsePdf',

  // Paper Discovery
  PAPER_GET_ALL: 'paper:getAll',
  PAPER_GET_BY_ID: 'paper:getById',
  PAPER_ADD_MANUAL: 'paper:addManual',
  PAPER_UPDATE: 'paper:update',
  PAPER_DELETE: 'paper:delete',
  PAPER_FETCH_PUBMED: 'paper:fetchPubmed',
  PAPER_GET_PROFILES: 'paper:getProfiles',
  PAPER_SAVE_PROFILE: 'paper:saveProfile',
  PAPER_DELETE_PROFILE: 'paper:deleteProfile',
  PAPER_LINK_PDF: 'paper:linkPdf',
  PAPER_CHECK_PDF_PATH: 'paper:checkPdfPath',

  // Job Search
  JOB_GET_ALL: 'job:getAll',
  JOB_GET_BY_ID: 'job:getById',
  JOB_ADD: 'job:add',
  JOB_UPDATE: 'job:update',
  JOB_DELETE: 'job:delete',
  JOB_ENRICH: 'job:enrich',
  JOB_IMAP_TEST: 'job:imapTest',
  JOB_IMAP_POLL: 'job:imapPoll',
  JOB_IMAP_TEST_PARSING: 'job:imapTestParsing',
  JOB_GET_MATERIAL: 'job:getMaterial',
  JOB_SAVE_MATERIAL: 'job:saveMaterial',
  JOB_GET_QA: 'job:getQa',
  JOB_SAVE_QA: 'job:saveQa',
  JOB_DELETE_QA: 'job:deleteQa',
  JOB_GET_QA_TEMPLATES: 'job:getQaTemplates',
  JOB_GET_NOTES: 'job:getNotes',
  JOB_SAVE_NOTES: 'job:saveNotes',
  JOB_MARK_APPLIED: 'job:markApplied',
  JOB_EXPORT_MATERIALS: 'job:exportMaterials',
  JOB_EXPORT_DOCX: 'job:exportDocx',
  JOB_EXPORT_PDF: 'job:exportPdf',
  JOB_FETCH_COMPANY_PAGE: 'job:fetchCompanyPage',
  JOB_OPEN_FILE: 'job:openFile',
  JOB_PREVIEW_URL: 'job:previewUrl',
  RESUME_COMPARE_WINDOW_OPEN: 'resumeCompare:openWindow',
  RESUME_COMPARE_WINDOW_UPDATE: 'resumeCompare:updateWindow',
  RESUME_COMPARE_WINDOW_CLOSE: 'resumeCompare:closeWindow',
  RESUME_COMPARE_WINDOW_DATA: 'resumeCompare:data',
  RESUME_COMPARE_WINDOW_STATE: 'resumeCompare:state',
  LINKEDIN_OPEN_URL: 'linkedin:openUrl',
  LINKEDIN_PROBE_URLS: 'linkedin:probeUrls',
  LINKEDIN_SET_TRACK_MODE: 'linkedin:setTrackMode',
  LINKEDIN_CAPTURE_RESULT: 'linkedin:captureResult',
  LINKEDIN_SET_MANUAL_ENRICH: 'linkedin:setManualEnrich',
  LINKEDIN_MANUAL_ENRICH_RESULT: 'linkedin:manualEnrichResult',
  PATTERN_SAVE: 'pattern:save',

  // Application Tracker
  TRACKER_GET_ALL: 'tracker:getAll',
  TRACKER_UPDATE_STATUS: 'tracker:updateStatus',
  TRACKER_DELETE: 'tracker:delete',

  // Interview Prep
  INTERVIEW_GET_BRIEF: 'interview:getBrief',
  INTERVIEW_SAVE_BRIEF: 'interview:saveBrief',
  INTERVIEW_GET_SESSIONS: 'interview:getSessions',
  INTERVIEW_GET_SESSION: 'interview:getSession',
  INTERVIEW_CREATE_SESSION: 'interview:createSession',
  INTERVIEW_UPDATE_SESSION: 'interview:updateSession',
  INTERVIEW_SAVE_EXCHANGE: 'interview:saveExchange',
  INTERVIEW_GET_EXCHANGES: 'interview:getExchanges',
  INTERVIEW_DELETE_SESSION: 'interview:deleteSession',
  INTERVIEW_APPEND_NOTES: 'interview:appendNotes',
  INTERVIEW_HAS_ACTIVE: 'interview:hasActive',

  // Code Learning — file ops
  CODE_LEARNING_OPEN_IN_VSCODE: 'code-learning:openInVSCode',
  CODE_LEARNING_SCAFFOLD_PROJECT: 'code-learning:scaffoldProject',
  CODE_LEARNING_UPDATE_ACTIVE_PROJECTS: 'code-learning:updateActiveProjects',
  CODE_LEARNING_UPDATE_PROJECT_FOLDER: 'code-learning:updateProjectFolder',

  // Code Learning — LLM (handle = request/response; on = streaming)
  CODE_LEARNING_GENERATE_PROPOSAL: 'code-learning:generate-proposal',
  CODE_LEARNING_GENERATE_CURRICULUM: 'code-learning:generate-curriculum',
  CODE_LEARNING_COACHING_MESSAGE: 'code-learning:coaching-message',
  CODE_LEARNING_REVIEW_CODE: 'code-learning:review-code',

  // Code Learning — status
  CODE_LEARNING_GET_WS_STATUS: 'code-learning:get-ws-status',

  // Code Learning — DB CRUD
  CODE_LEARNING_GET_ACTIVE_PROJECT: 'code-learning:get-active-project',
  CODE_LEARNING_SAVE_PROJECT: 'code-learning:save-project',
  CODE_LEARNING_UPDATE_STEP: 'code-learning:update-step',
  CODE_LEARNING_SAVE_MESSAGE: 'code-learning:save-message',
  CODE_LEARNING_UPDATE_HINTS: 'code-learning:update-hints',
  CODE_LEARNING_GET_STEP_MESSAGES: 'code-learning:get-step-messages',

  // System
  OPEN_FOLDER_PICKER: 'system:openFolderPicker',
  OPEN_FILE_PICKER: 'system:openFilePicker',
  OPEN_EXTERNAL: 'system:openExternal',
  OPEN_PATH: 'system:openPath',
  SHOW_LINKEDIN_BROWSER: 'linkedin:showBrowser',
  HIDE_LINKEDIN_BROWSER: 'linkedin:hideBrowser',
  LINKEDIN_LOGOUT: 'linkedin:logout',
} as const
