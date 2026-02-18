// ─── LLM ────────────────────────────────────────────────────────────────────

export type LLMProvider = 'anthropic' | 'openai'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface LLMRequest {
  provider: LLMProvider
  model: string
  messages: ChatMessage[]
  systemPrompt: string
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
  dbPath: string
  imapHost: string
  imapPort: number
  imapUser: string
  imapPass: string
  imapTls: boolean
  imapForwardingAddress: string
  linkedinPartition: string
  interviewResearchDepth: 'quick' | 'deep' | 'always_ask'
  models: {
    postGenerator: string
    paperDiscovery: string
    resumeGenerator: string
    coverLetterGenerator: string
    qaGenerator: string
    interviewResearch: string
  }
}

export interface ResumeBase {
  id: number
  name: string
  content: string
  format: 'docx' | 'text'
  createdAt: string
  updatedAt: string
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
  JOB_EXPORT_DOCX: 'job:exportDocx',
  JOB_EXPORT_PDF: 'job:exportPdf',
  JOB_FETCH_COMPANY_PAGE: 'job:fetchCompanyPage',
  JOB_OPEN_FILE: 'job:openFile',
  JOB_PREVIEW_URL: 'job:previewUrl',

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

  // System
  OPEN_FOLDER_PICKER: 'system:openFolderPicker',
  OPEN_FILE_PICKER: 'system:openFilePicker',
  OPEN_EXTERNAL: 'system:openExternal',
  OPEN_PATH: 'system:openPath',
  SHOW_LINKEDIN_BROWSER: 'linkedin:showBrowser',
  HIDE_LINKEDIN_BROWSER: 'linkedin:hideBrowser',
  LINKEDIN_LOGOUT: 'linkedin:logout',
} as const
