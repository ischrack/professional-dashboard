import { ipcMain, safeStorage, app } from 'electron'
import path from 'path'
import fs from 'fs'
import { getDb } from '../db'
import type { AppSettings, ResumeBase } from '../../shared/types'
import { IPC } from '../../shared/types'

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json')

const DEFAULT_SETTINGS: Omit<AppSettings, 'anthropicKey' | 'openaiKey' | 'pubmedKey' | 'imapPass'> = {
  outputFolder: app.getPath('documents'),
  dbPath: '',
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  imapUser: '',
  imapTls: true,
  imapForwardingAddress: '',
  linkedinPartition: 'persist:linkedin',
  models: {
    postGenerator: 'claude-sonnet-4-6',
    paperDiscovery: 'claude-haiku-4-5-20251001',
    resumeGenerator: 'claude-opus-4-6',
    coverLetterGenerator: 'claude-opus-4-6',
    qaGenerator: 'claude-sonnet-4-6',
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
    return db.prepare('SELECT * FROM resume_bases ORDER BY name').all() as ResumeBase[]
  })

  ipcMain.handle(IPC.SAVE_RESUME_BASE, (_evt, base: Partial<ResumeBase> & { name: string; content: string }) => {
    const db = getDb()
    if (base.id) {
      db.prepare(`UPDATE resume_bases SET name=?, content=?, format=?, updated_at=datetime('now') WHERE id=?`)
        .run(base.name, base.content, base.format || 'text', base.id)
      return base.id
    } else {
      const result = db.prepare(`INSERT INTO resume_bases (name, content, format) VALUES (?, ?, ?)`)
        .run(base.name, base.content, base.format || 'text')
      return result.lastInsertRowid
    }
  })

  ipcMain.handle(IPC.DELETE_RESUME_BASE, (_evt, id: number) => {
    const db = getDb()
    db.prepare('DELETE FROM resume_bases WHERE id=?').run(id)
    return true
  })
}

export { getEncryptedKey }
