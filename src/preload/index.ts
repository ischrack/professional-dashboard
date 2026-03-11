import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/types'
import type { ResumeCompareWindowPayload, ResumeCompareWindowState, VSCodeMessage } from '../shared/types'

// Expose all IPC channels via a typed API
const api = {
  // Generic invoke wrapper
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  setSettings: (updates: Record<string, unknown>) => ipcRenderer.invoke(IPC.SET_SETTINGS, updates),
  getApiKey: (name: string) => ipcRenderer.invoke(IPC.GET_API_KEY, name),
  setApiKey: (name: string, value: string) => ipcRenderer.invoke(IPC.SET_API_KEY, name, value),
  getResumeBases: () => ipcRenderer.invoke(IPC.GET_RESUME_BASES),
  saveResumeBase: (base: Record<string, unknown>) => ipcRenderer.invoke(IPC.SAVE_RESUME_BASE, base),
  deleteResumeBase: (id: number) => ipcRenderer.invoke(IPC.DELETE_RESUME_BASE, id),
  getResumeBaseVersions: (baseId: number) => ipcRenderer.invoke(IPC.GET_RESUME_BASE_VERSIONS, baseId),
  restoreResumeBaseVersion: (baseId: number, versionId: number) => ipcRenderer.invoke(IPC.RESTORE_RESUME_BASE_VERSION, baseId, versionId),
  parseResumeFile: (filePath: string) => ipcRenderer.invoke(IPC.PARSE_RESUME_FILE, filePath),

  // LLM
  llmCall: (req: Record<string, unknown>) => ipcRenderer.invoke(IPC.LLM_CALL, req),

  // Post Generator
  postGetSessions: () => ipcRenderer.invoke(IPC.POST_GET_SESSIONS),
  postGetSession: (id: number) => ipcRenderer.invoke(IPC.POST_GET_SESSION, id),
  postSaveSession: (session: Record<string, unknown>) => ipcRenderer.invoke(IPC.POST_SAVE_SESSION, session),
  postDeleteSession: (id: number) => ipcRenderer.invoke(IPC.POST_DELETE_SESSION, id),
  postFetchUrl: (url: string) => ipcRenderer.invoke(IPC.POST_FETCH_URL, url),
  postParsePdf: (filePath: string) => ipcRenderer.invoke(IPC.POST_PARSE_PDF, filePath),

  // Paper Discovery
  paperGetAll: (filters?: Record<string, unknown>) => ipcRenderer.invoke(IPC.PAPER_GET_ALL, filters),
  paperGetById: (id: number) => ipcRenderer.invoke(IPC.PAPER_GET_BY_ID, id),
  paperAddManual: (doiOrPmid: string) => ipcRenderer.invoke(IPC.PAPER_ADD_MANUAL, doiOrPmid),
  paperUpdate: (id: number, updates: Record<string, unknown>) => ipcRenderer.invoke(IPC.PAPER_UPDATE, id, updates),
  paperDelete: (id: number) => ipcRenderer.invoke(IPC.PAPER_DELETE, id),
  paperFetchPubmed: () => ipcRenderer.invoke(IPC.PAPER_FETCH_PUBMED),
  paperGetProfiles: () => ipcRenderer.invoke(IPC.PAPER_GET_PROFILES),
  paperSaveProfile: (profile: Record<string, unknown>) => ipcRenderer.invoke(IPC.PAPER_SAVE_PROFILE, profile),
  paperDeleteProfile: (id: number) => ipcRenderer.invoke(IPC.PAPER_DELETE_PROFILE, id),
  paperLinkPdf: (paperId: number, filePath: string) => ipcRenderer.invoke(IPC.PAPER_LINK_PDF, paperId, filePath),
  paperCheckPdfPath: (filePath: string) => ipcRenderer.invoke(IPC.PAPER_CHECK_PDF_PATH, filePath),

  // Job Search
  jobGetAll: () => ipcRenderer.invoke(IPC.JOB_GET_ALL),
  jobGetById: (id: number) => ipcRenderer.invoke(IPC.JOB_GET_BY_ID, id),
  jobAdd: (job: Record<string, unknown>) => ipcRenderer.invoke(IPC.JOB_ADD, job),
  jobUpdate: (id: number, updates: Record<string, unknown>) => ipcRenderer.invoke(IPC.JOB_UPDATE, id, updates),
  jobDelete: (id: number) => ipcRenderer.invoke(IPC.JOB_DELETE, id),
  jobEnrich: (ids: number[]) => ipcRenderer.invoke(IPC.JOB_ENRICH, ids),
  jobImapTest: () => ipcRenderer.invoke(IPC.JOB_IMAP_TEST),
  jobImapPoll: () => ipcRenderer.invoke(IPC.JOB_IMAP_POLL),
  jobImapTestParsing: () => ipcRenderer.invoke(IPC.JOB_IMAP_TEST_PARSING),
  jobGetMaterial: (jobId: number, type: string) => ipcRenderer.invoke(IPC.JOB_GET_MATERIAL, jobId, type),
  jobSaveMaterial: (material: Record<string, unknown>) => ipcRenderer.invoke(IPC.JOB_SAVE_MATERIAL, material),
  jobGetQa: (jobId: number) => ipcRenderer.invoke(IPC.JOB_GET_QA, jobId),
  jobSaveQa: (entry: Record<string, unknown>) => ipcRenderer.invoke(IPC.JOB_SAVE_QA, entry),
  jobDeleteQa: (id: number) => ipcRenderer.invoke(IPC.JOB_DELETE_QA, id),
  jobGetQaTemplates: () => ipcRenderer.invoke(IPC.JOB_GET_QA_TEMPLATES),
  jobGetNotes: (jobId: number) => ipcRenderer.invoke(IPC.JOB_GET_NOTES, jobId),
  jobSaveNotes: (jobId: number, content: string) => ipcRenderer.invoke(IPC.JOB_SAVE_NOTES, jobId, content),
  jobMarkApplied: (jobId: number, data: Record<string, unknown>) => ipcRenderer.invoke(IPC.JOB_MARK_APPLIED, jobId, data),
  jobExportMaterials: (payload: Record<string, unknown>) => ipcRenderer.invoke(IPC.JOB_EXPORT_MATERIALS, payload),
  jobExportDocx: (jobId: number, type: string, html: string, lastName: string) => ipcRenderer.invoke(IPC.JOB_EXPORT_DOCX, jobId, type, html, lastName),
  jobOpenFile: (filePath: string) => ipcRenderer.invoke(IPC.JOB_OPEN_FILE, filePath),
  jobFetchCompanyPage: (company: string, url?: string) => ipcRenderer.invoke(IPC.JOB_FETCH_COMPANY_PAGE, company, url),
  jobPreviewUrl: (url: string) => ipcRenderer.invoke(IPC.JOB_PREVIEW_URL, url),
  resumeCompareOpen: (payload: ResumeCompareWindowPayload) => ipcRenderer.invoke(IPC.RESUME_COMPARE_WINDOW_OPEN, payload),
  resumeCompareUpdate: (payload: ResumeCompareWindowPayload) => ipcRenderer.invoke(IPC.RESUME_COMPARE_WINDOW_UPDATE, payload),
  resumeCompareClose: () => ipcRenderer.invoke(IPC.RESUME_COMPARE_WINDOW_CLOSE),
  onResumeCompareData: (cb: (payload: ResumeCompareWindowPayload) => void): (() => void) => {
    const handler = (_: unknown, payload: ResumeCompareWindowPayload) => cb(payload)
    ipcRenderer.on(IPC.RESUME_COMPARE_WINDOW_DATA, handler)
    return () => ipcRenderer.removeListener(IPC.RESUME_COMPARE_WINDOW_DATA, handler)
  },
  onResumeCompareState: (cb: (state: ResumeCompareWindowState) => void): (() => void) => {
    const handler = (_: unknown, state: ResumeCompareWindowState) => cb(state)
    ipcRenderer.on(IPC.RESUME_COMPARE_WINDOW_STATE, handler)
    return () => ipcRenderer.removeListener(IPC.RESUME_COMPARE_WINDOW_STATE, handler)
  },

  // Tracker
  trackerGetAll: () => ipcRenderer.invoke(IPC.TRACKER_GET_ALL),
  trackerUpdateStatus: (jobId: number, status: string) => ipcRenderer.invoke(IPC.TRACKER_UPDATE_STATUS, jobId, status),
  trackerDelete: (jobId: number) => ipcRenderer.invoke(IPC.TRACKER_DELETE, jobId),

  // System
  openFolderPicker: () => ipcRenderer.invoke(IPC.OPEN_FOLDER_PICKER),
  openFilePicker: (filters?: unknown[]) => ipcRenderer.invoke(IPC.OPEN_FILE_PICKER, filters),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
  openPath: (filePath: string) => ipcRenderer.invoke(IPC.OPEN_PATH, filePath),

  // LinkedIn
  showLinkedInBrowser: () => ipcRenderer.invoke(IPC.SHOW_LINKEDIN_BROWSER),
  hideLinkedInBrowser: () => ipcRenderer.invoke(IPC.HIDE_LINKEDIN_BROWSER),
  linkedinOpenUrl: (url: string) => ipcRenderer.invoke(IPC.LINKEDIN_OPEN_URL, url),
  linkedinProbeUrls: (urls: string[]) => ipcRenderer.invoke(IPC.LINKEDIN_PROBE_URLS, urls),
  linkedinLogout: () => ipcRenderer.invoke(IPC.LINKEDIN_LOGOUT),
  linkedinSetTrackMode: (on: boolean) => ipcRenderer.invoke(IPC.LINKEDIN_SET_TRACK_MODE, on),
  onLinkedinCaptureResult: (cb: (report: unknown) => void): (() => void) => {
    const handler = (_: unknown, data: unknown) => cb(data)
    ipcRenderer.on(IPC.LINKEDIN_CAPTURE_RESULT, handler)
    return () => ipcRenderer.removeListener(IPC.LINKEDIN_CAPTURE_RESULT, handler)
  },
  linkedinSetManualEnrich: (jobId: number) => ipcRenderer.invoke(IPC.LINKEDIN_SET_MANUAL_ENRICH, jobId),
  onLinkedinManualEnrichResult: (cb: (result: unknown) => void): (() => void) => {
    const handler = (_: unknown, data: unknown) => cb(data)
    ipcRenderer.on(IPC.LINKEDIN_MANUAL_ENRICH_RESULT, handler)
    return () => ipcRenderer.removeListener(IPC.LINKEDIN_MANUAL_ENRICH_RESULT, handler)
  },
  patternSave: (pattern: Record<string, unknown>) => ipcRenderer.invoke(IPC.PATTERN_SAVE, pattern),

  // VS Code WebSocket bridge
  wsSend: (msg: VSCodeMessage) => ipcRenderer.send('ws:send', msg),
  onWsMessage: (cb: (msg: VSCodeMessage) => void): (() => void) => {
    const handler = (_: unknown, msg: VSCodeMessage) => cb(msg)
    ipcRenderer.on('ws:message', handler)
    return () => ipcRenderer.removeListener('ws:message', handler)
  },

  // Code Learning — file ops
  codeLearningOpenInVSCode: (folderPath: string) => ipcRenderer.invoke(IPC.CODE_LEARNING_OPEN_IN_VSCODE, folderPath),
  codeLearningScaffoldProject: (folderPath: string) => ipcRenderer.invoke(IPC.CODE_LEARNING_SCAFFOLD_PROJECT, folderPath),
  codeLearningUpdateActiveProjects: (projects: Array<{ id: string; folderPath: string | null; activeStepId: string | null; targetFile: string | null }>) =>
    ipcRenderer.invoke(IPC.CODE_LEARNING_UPDATE_ACTIVE_PROJECTS, projects),
  codeLearningUpdateProjectFolder: (projectId: string, folderPath: string) =>
    ipcRenderer.invoke(IPC.CODE_LEARNING_UPDATE_PROJECT_FOLDER, projectId, folderPath),

  // Code Learning — LLM (request/response)
  codeLearningGenerateProposal: (payload: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.CODE_LEARNING_GENERATE_PROPOSAL, payload),
  codeLearningReviewCode: (payload: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.CODE_LEARNING_REVIEW_CODE, payload),

  // Code Learning — LLM (streaming fire-and-forget)
  codeLearningGenerateCurriculum: (payload: Record<string, unknown>) =>
    ipcRenderer.send(IPC.CODE_LEARNING_GENERATE_CURRICULUM, payload),
  codeLearningCoachingMessage: (payload: Record<string, unknown>) =>
    ipcRenderer.send(IPC.CODE_LEARNING_COACHING_MESSAGE, payload),

  // Code Learning — streaming event listeners
  onCurriculumChunk: (cb: (token: string) => void): (() => void) => {
    const handler = (_: unknown, token: string) => cb(token)
    ipcRenderer.on('code-learning:curriculum-chunk', handler)
    return () => ipcRenderer.removeListener('code-learning:curriculum-chunk', handler)
  },
  onCurriculumStepReady: (cb: (step: { step_number: number; title: string }) => void): (() => void) => {
    const handler = (_: unknown, step: { step_number: number; title: string }) => cb(step)
    ipcRenderer.on('code-learning:step-ready', handler)
    return () => ipcRenderer.removeListener('code-learning:step-ready', handler)
  },
  onCurriculumDone: (cb: (project: Record<string, unknown>) => void): (() => void) => {
    const handler = (_: unknown, project: Record<string, unknown>) => cb(project)
    ipcRenderer.on('code-learning:curriculum-done', handler)
    return () => ipcRenderer.removeListener('code-learning:curriculum-done', handler)
  },
  onCurriculumError: (cb: (err: string) => void): (() => void) => {
    const handler = (_: unknown, err: string) => cb(err)
    ipcRenderer.on('code-learning:curriculum-error', handler)
    return () => ipcRenderer.removeListener('code-learning:curriculum-error', handler)
  },
  onCoachingChunk: (cb: (token: string) => void): (() => void) => {
    const handler = (_: unknown, token: string) => cb(token)
    ipcRenderer.on('code-learning:coaching-chunk', handler)
    return () => ipcRenderer.removeListener('code-learning:coaching-chunk', handler)
  },
  onCoachingDone: (cb: (result: { content: string }) => void): (() => void) => {
    const handler = (_: unknown, result: { content: string }) => cb(result)
    ipcRenderer.on('code-learning:coaching-done', handler)
    return () => ipcRenderer.removeListener('code-learning:coaching-done', handler)
  },
  onCoachingError: (cb: (err: string) => void): (() => void) => {
    const handler = (_: unknown, err: string) => cb(err)
    ipcRenderer.on('code-learning:coaching-error', handler)
    return () => ipcRenderer.removeListener('code-learning:coaching-error', handler)
  },

  // Code Learning — status
  getVsCodeStatus: () => ipcRenderer.invoke(IPC.CODE_LEARNING_GET_WS_STATUS),

  // Code Learning — DB CRUD
  codeLearningGetActiveProject: () => ipcRenderer.invoke(IPC.CODE_LEARNING_GET_ACTIVE_PROJECT),
  codeLearningGetStepMessages: (stepId: string) => ipcRenderer.invoke(IPC.CODE_LEARNING_GET_STEP_MESSAGES, stepId),
  codeLearningUpdateStep: (payload: Record<string, unknown>) => ipcRenderer.invoke(IPC.CODE_LEARNING_UPDATE_STEP, payload),
  codeLearningUpdateHints: (payload: Record<string, unknown>) => ipcRenderer.invoke(IPC.CODE_LEARNING_UPDATE_HINTS, payload),
  codeLearningSaveProject: (payload: Record<string, unknown>) => ipcRenderer.invoke(IPC.CODE_LEARNING_SAVE_PROJECT, payload),
  codeLearningSaveMessage: (payload: Record<string, unknown>) => ipcRenderer.invoke(IPC.CODE_LEARNING_SAVE_MESSAGE, payload),

  // Interview Prep — CRUD
  interviewGetBrief: (jobId: number) => ipcRenderer.invoke(IPC.INTERVIEW_GET_BRIEF, jobId),
  interviewSaveBrief: (data: Record<string, unknown>) => ipcRenderer.invoke(IPC.INTERVIEW_SAVE_BRIEF, data),
  interviewGetSessions: (jobId: number) => ipcRenderer.invoke(IPC.INTERVIEW_GET_SESSIONS, jobId),
  interviewGetSession: (sessionId: number) => ipcRenderer.invoke(IPC.INTERVIEW_GET_SESSION, sessionId),
  interviewCreateSession: (data: Record<string, unknown>) => ipcRenderer.invoke(IPC.INTERVIEW_CREATE_SESSION, data),
  interviewUpdateSession: (sessionId: number, updates: Record<string, unknown>) => ipcRenderer.invoke(IPC.INTERVIEW_UPDATE_SESSION, sessionId, updates),
  interviewSaveExchange: (data: Record<string, unknown>) => ipcRenderer.invoke(IPC.INTERVIEW_SAVE_EXCHANGE, data),
  interviewGetExchanges: (sessionId: number) => ipcRenderer.invoke(IPC.INTERVIEW_GET_EXCHANGES, sessionId),
  interviewDeleteSession: (sessionId: number) => ipcRenderer.invoke(IPC.INTERVIEW_DELETE_SESSION, sessionId),
  interviewAppendNotes: (jobId: number, text: string) => ipcRenderer.invoke(IPC.INTERVIEW_APPEND_NOTES, jobId, text),
  interviewHasActive: (jobId: number) => ipcRenderer.invoke(IPC.INTERVIEW_HAS_ACTIVE, jobId),

  // Interview Prep — Streaming (fire-and-forget send; results come back via events)
  interviewStartResearch: (data: Record<string, unknown>) => ipcRenderer.send('interview:start-research', data),
  interviewSendChat: (data: Record<string, unknown>) => ipcRenderer.send('interview:send-chat', data),

  // Interview Prep — Stream listeners (return cleanup functions)
  onInterviewToken: (cb: (token: string) => void): (() => void) => {
    const handler = (_evt: unknown, token: string) => cb(token)
    ipcRenderer.on('interview:token', handler)
    return () => ipcRenderer.removeListener('interview:token', handler)
  },
  onInterviewSearchEvent: (cb: (evt: Record<string, unknown>) => void): (() => void) => {
    const handler = (_evt: unknown, data: Record<string, unknown>) => cb(data)
    ipcRenderer.on('interview:search-event', handler)
    return () => ipcRenderer.removeListener('interview:search-event', handler)
  },
  onInterviewResearchDone: (cb: (result: Record<string, unknown>) => void): (() => void) => {
    const handler = (_evt: unknown, data: Record<string, unknown>) => cb(data)
    ipcRenderer.on('interview:research-done', handler)
    return () => ipcRenderer.removeListener('interview:research-done', handler)
  },
  onInterviewChatToken: (cb: (token: string) => void): (() => void) => {
    const handler = (_evt: unknown, token: string) => cb(token)
    ipcRenderer.on('interview:chat-token', handler)
    return () => ipcRenderer.removeListener('interview:chat-token', handler)
  },
  onInterviewChatDone: (cb: (result: Record<string, unknown>) => void): (() => void) => {
    const handler = (_evt: unknown, data: Record<string, unknown>) => cb(data)
    ipcRenderer.on('interview:chat-done', handler)
    return () => ipcRenderer.removeListener('interview:chat-done', handler)
  },
  onInterviewStreamError: (cb: (err: string) => void): (() => void) => {
    const handler = (_evt: unknown, err: string) => cb(err)
    ipcRenderer.on('interview:stream-error', handler)
    return () => ipcRenderer.removeListener('interview:stream-error', handler)
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
