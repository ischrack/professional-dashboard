import { ipcMain, safeStorage, app } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFileSync } from 'child_process'
import { getDb } from '../db'
import type { AppSettings, ResumeBase, ResumeBaseVersion } from '../../shared/types'
import { IPC } from '../../shared/types'

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json')

const DEFAULT_SETTINGS: Omit<AppSettings, 'anthropicKey' | 'openaiKey' | 'pubmedKey' | 'imapPass'> = {
  outputFolder: app.getPath('documents'),
  exportNamePrefix: '',
  resumeLayoutPreset: 'ats_standard',
  dbPath: '',
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  imapUser: '',
  imapTls: true,
  imapForwardingAddress: '',
  linkedinPartition: 'persist:linkedin',
  interviewResearchDepth: 'always_ask',
  codeLearningProjectFolder: path.join(app.getPath('home'), 'Projects'),
  codeLearningReviewOnSave: false,
  codeLearningOllamaEndpoint: '',
  models: {
    postGenerator: 'claude-sonnet-4-5',
    paperDiscovery: 'claude-haiku-4-5-20251001',
    resumeGenerator: 'claude-opus-4-5',
    coverLetterGenerator: 'claude-opus-4-5',
    qaGenerator: 'claude-sonnet-4-5',
    codeLearning: 'gpt-4o',
  },
}

function loadSettings(): Record<string, unknown> {
  if (!fs.existsSync(SETTINGS_FILE)) return {}
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveSettings(data: Record<string, unknown>): void {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2))
}

// One-time settings migrations — called once at app startup before IPC handlers register.
export function migrateSettings(): void {
  console.log('[migrateSettings] settings file path:', SETTINGS_FILE)

  const data = loadSettings()
  const models = data.models as Record<string, string> | undefined
  if (!models) {
    console.log('[migrateSettings] no models object found — nothing to migrate')
    return
  }

  console.log('[migrateSettings] models object from file:', JSON.stringify(models))

  // Replace stale model strings across ALL module keys.
  const STALE: Record<string, string> = {
    'claude-opus-4-6': 'claude-opus-4-5',
    'claude-sonnet-4-6': 'claude-sonnet-4-5',
  }
  // codeLearning is intentionally mapped to gpt-4o rather than claude-opus-4-5.
  const CODE_LEARNING_STALE = 'claude-opus-4-6'

  let dirty = false
  for (const key of Object.keys(models)) {
    const current = models[key]
    const replacement = key === 'codeLearning' && current === CODE_LEARNING_STALE
      ? 'gpt-4o'
      : STALE[current]
    if (replacement) {
      console.log(`[migrateSettings] models.${key}: "${current}" → "${replacement}"`)
      models[key] = replacement
      dirty = true
    }
  }

  // Backfill missing keys that were added after the user's settings file was created.
  if (models.codeLearning === undefined || models.codeLearning === null) {
    console.log('[migrateSettings] models.codeLearning missing — setting default "gpt-4o"')
    models.codeLearning = 'gpt-4o'
    dirty = true
  }

  if (dirty) {
    data.models = models
    saveSettings(data)
    console.log('[migrateSettings] settings file updated')
  } else {
    console.log('[migrateSettings] no stale values found — file unchanged')
  }
}

// Encrypted key storage
function getEncryptedKey(name: string): string {
  const data = loadSettings()
  const encrypted = data[`key_${name}`] as Buffer | string | undefined
  if (!encrypted) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.isBuffer(encrypted) ? encrypted : Buffer.from(encrypted as string, 'base64')
      return safeStorage.decryptString(buf)
    }
    return encrypted as string
  } catch {
    return ''
  }
}

function setEncryptedKey(name: string, value: string): void {
  const data = loadSettings()
  if (safeStorage.isEncryptionAvailable() && value) {
    data[`key_${name}`] = safeStorage.encryptString(value).toString('base64')
  } else {
    data[`key_${name}`] = value
  }
  saveSettings(data)
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function nextResumeBaseVersionNumber(baseId: number): number {
  const db = getDb()
  const row = db.prepare('SELECT COALESCE(MAX(version_number), 0) as maxVersion FROM resume_base_versions WHERE base_id = ?')
    .get(baseId) as { maxVersion: number }
  return (row?.maxVersion || 0) + 1
}

function insertResumeBaseVersion(data: {
  baseId: number
  content: string
  format: 'docx' | 'pdf' | 'text'
  sourceFileName?: string | null
  sourceFilePath?: string | null
}): number {
  const db = getDb()
  const versionNumber = nextResumeBaseVersionNumber(data.baseId)
  const result = db.prepare(`
    INSERT INTO resume_base_versions
      (base_id, version_number, content, format, source_file_name, source_file_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    data.baseId,
    versionNumber,
    data.content || '',
    data.format || 'text',
    data.sourceFileName || null,
    data.sourceFilePath || null,
  )
  return result.lastInsertRowid as number
}

function parseDocLikeWithTextUtil(filePath: string): string {
  const output = execFileSync(
    'textutil',
    ['-convert', 'txt', '-stdout', filePath],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  )
  return normalizeExtractedText(output || '')
}

function parsePdfWithMdls(filePath: string): string {
  try {
    const output = execFileSync(
      'mdls',
      ['-raw', '-name', 'kMDItemTextContent', filePath],
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
    )
    if (!output || output.includes('(null)')) return ''
    return normalizeExtractedText(output)
  } catch {
    return ''
  }
}

function copySourceFileToVault(filePath: string): string {
  const vaultDir = path.join(app.getPath('userData'), 'resume_vault_files')
  if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true })
  const ext = path.extname(filePath).toLowerCase()
  const base = path.basename(filePath, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'import'
  const stamped = `${Date.now()}_${base}${ext}`
  const storedPath = path.join(vaultDir, stamped)
  fs.copyFileSync(filePath, storedPath)
  return storedPath
}

async function parsePdfWithPdfJs(filePath: string): Promise<string> {
  const bytes = fs.readFileSync(filePath)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as any
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdf = await loadingTask.promise as any
  const pageTexts: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await pdf.getPage(i) as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = await page.getTextContent() as any
    const pageText = (content.items || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it: any) => (typeof it?.str === 'string' ? it.str : ''))
      .filter(Boolean)
      .join(' ')
    if (pageText.trim()) pageTexts.push(pageText.trim())
  }
  return normalizeExtractedText(pageTexts.join('\n\n'))
}

async function parseResumeFile(filePath: string): Promise<{
  success: boolean
  content?: string
  format?: 'docx' | 'pdf' | 'text'
  fileName?: string
  filePath?: string
  error?: string
}> {
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath)

  try {
    if (ext === '.txt' || ext === '.md') {
      const content = normalizeExtractedText(fs.readFileSync(filePath, 'utf8'))
      if (!content) return { success: false, error: 'No text content found in file.' }
      const storedFilePath = copySourceFileToVault(filePath)
      return { success: true, content, format: 'text', fileName, filePath: storedFilePath }
    }

    if (ext === '.docx' || ext === '.doc' || ext === '.rtf') {
      const content = parseDocLikeWithTextUtil(filePath)
      if (!content) return { success: false, error: 'Could not extract text from document.' }
      const storedFilePath = copySourceFileToVault(filePath)
      return { success: true, content, format: 'docx', fileName, filePath: storedFilePath }
    }

    if (ext === '.pdf') {
      let content = ''
      try {
        content = await parsePdfWithPdfJs(filePath)
      } catch {
        content = ''
      }
      if (!content) {
        content = parsePdfWithMdls(filePath)
      }
      if (!content) {
        return { success: false, error: 'Could not extract text from PDF. Try DOCX/TXT import or paste text manually.' }
      }
      const storedFilePath = copySourceFileToVault(filePath)
      return { success: true, content, format: 'pdf', fileName, filePath: storedFilePath }
    }

    return { success: false, error: 'Unsupported file type. Use .docx, .pdf, .txt, .md, or .doc.' }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.GET_SETTINGS, () => {
    const data = loadSettings()
    return {
      ...DEFAULT_SETTINGS,
      ...data,
      anthropicKey: '***',
      openaiKey: '***',
      pubmedKey: '***',
      imapPass: '***',
    }
  })

  ipcMain.handle(IPC.SET_SETTINGS, (_evt, updates: Partial<AppSettings>) => {
    const data = loadSettings()
    const { anthropicKey, openaiKey, pubmedKey, imapPass, ...rest } = updates as AppSettings
    Object.assign(data, rest)
    saveSettings(data)
    return true
  })

  ipcMain.handle(IPC.GET_API_KEY, (_evt, name: string) => {
    return getEncryptedKey(name)
  })

  ipcMain.handle(IPC.SET_API_KEY, (_evt, name: string, value: string) => {
    setEncryptedKey(name, value)
    return true
  })

  // Resume bases
  ipcMain.handle(IPC.GET_RESUME_BASES, () => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT
        rb.id,
        rb.name,
        rb.content,
        rb.format,
        rb.doc_type as docType,
        rb.locked_sections as lockedSections,
        rb.source_file_name as sourceFileName,
        rb.source_file_path as sourceFilePath,
        rb.created_at as createdAt,
        rb.updated_at as updatedAt,
        COALESCE((
          SELECT MAX(rv.version_number)
          FROM resume_base_versions rv
          WHERE rv.base_id = rb.id
        ), 1) as activeVersion
      FROM resume_bases rb
      ORDER BY rb.updated_at DESC, rb.name ASC
    `).all() as Array<ResumeBase & { lockedSections: string }>

    return rows.map((row) => ({
      ...row,
      lockedSections: (() => {
        try {
          const parsed = JSON.parse(row.lockedSections || '[]')
          return Array.isArray(parsed) ? parsed : ['publications']
        } catch {
          return ['publications']
        }
      })(),
    })) as ResumeBase[]
  })

  ipcMain.handle(IPC.SAVE_RESUME_BASE, (_evt, base: Partial<ResumeBase> & { name: string; content: string }) => {
    const db = getDb()
    const format = (base.format || 'text') as 'docx' | 'pdf' | 'text'
    const docType = base.docType === 'cv' ? 'cv' : 'resume'
    const lockedSections = JSON.stringify(
      Array.isArray(base.lockedSections) && base.lockedSections.length > 0
        ? base.lockedSections
        : ['publications'],
    )

    if (base.id) {
      db.prepare(`
        UPDATE resume_bases
        SET name=?, content=?, format=?, doc_type=?, locked_sections=?, source_file_name=?, source_file_path=?, updated_at=datetime('now')
        WHERE id=?
      `).run(
        base.name,
        base.content,
        format,
        docType,
        lockedSections,
        base.sourceFileName || null,
        base.sourceFilePath || null,
        base.id,
      )
      insertResumeBaseVersion({
        baseId: base.id,
        content: base.content,
        format,
        sourceFileName: base.sourceFileName || null,
        sourceFilePath: base.sourceFilePath || null,
      })
      return base.id
    } else {
      const result = db.prepare(`
        INSERT INTO resume_bases (name, content, format, doc_type, locked_sections, source_file_name, source_file_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        base.name,
        base.content,
        format,
        docType,
        lockedSections,
        base.sourceFileName || null,
        base.sourceFilePath || null,
      )
      const baseId = result.lastInsertRowid as number
      insertResumeBaseVersion({
        baseId,
        content: base.content,
        format,
        sourceFileName: base.sourceFileName || null,
        sourceFilePath: base.sourceFilePath || null,
      })
      return baseId
    }
  })

  ipcMain.handle(IPC.DELETE_RESUME_BASE, (_evt, id: number) => {
    const db = getDb()
    db.prepare('DELETE FROM resume_bases WHERE id=?').run(id)
    return true
  })

  ipcMain.handle(IPC.GET_RESUME_BASE_VERSIONS, (_evt, baseId: number) => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT
        id,
        base_id as baseId,
        version_number as versionNumber,
        content,
        format,
        source_file_name as sourceFileName,
        source_file_path as sourceFilePath,
        created_at as createdAt
      FROM resume_base_versions
      WHERE base_id = ?
      ORDER BY version_number DESC, created_at DESC
    `).all(baseId) as ResumeBaseVersion[]
    return rows
  })

  ipcMain.handle(IPC.RESTORE_RESUME_BASE_VERSION, (_evt, baseId: number, versionId: number) => {
    const db = getDb()
    const version = db.prepare(`
      SELECT content, format, source_file_name as sourceFileName, source_file_path as sourceFilePath
      FROM resume_base_versions
      WHERE id = ? AND base_id = ?
      LIMIT 1
    `).get(versionId, baseId) as {
      content: string
      format: 'docx' | 'pdf' | 'text'
      sourceFileName?: string
      sourceFilePath?: string
    } | undefined

    if (!version) return false

    db.prepare(`
      UPDATE resume_bases
      SET content = ?, format = ?, source_file_name = ?, source_file_path = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      version.content || '',
      version.format || 'text',
      version.sourceFileName || null,
      version.sourceFilePath || null,
      baseId,
    )

    insertResumeBaseVersion({
      baseId,
      content: version.content || '',
      format: version.format || 'text',
      sourceFileName: version.sourceFileName || null,
      sourceFilePath: version.sourceFilePath || null,
    })

    return true
  })

  ipcMain.handle(IPC.PARSE_RESUME_FILE, async (_evt, filePath: string) => {
    return parseResumeFile(filePath)
  })
}

export { getEncryptedKey }
