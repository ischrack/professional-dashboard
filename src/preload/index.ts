import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/types'

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
  jobExportDocx: (jobId: number, type: string, html: string, lastName: string) => ipcRenderer.invoke(IPC.JOB_EXPORT_DOCX, jobId, type, html, lastName),
  jobOpenFile: (filePath: string) => ipcRenderer.invoke(IPC.JOB_OPEN_FILE, filePath),
  jobFetchCompanyPage: (company: string, url?: string) => ipcRenderer.invoke(IPC.JOB_FETCH_COMPANY_PAGE, company, url),

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
  showLinkedInBrowser: (bounds?: Record<string, number>) => ipcRenderer.invoke(IPC.SHOW_LINKEDIN_BROWSER, bounds),
  hideLinkedInBrowser: () => ipcRenderer.invoke(IPC.HIDE_LINKEDIN_BROWSER),
  linkedinLogout: () => ipcRenderer.invoke(IPC.LINKEDIN_LOGOUT),
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
