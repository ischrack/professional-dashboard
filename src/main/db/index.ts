import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { initializeDatabase } from './schema'

let _db: Database.Database | null = null
let _dbPath: string = ''

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized')
  return _db
}

export function getDbPath(): string {
  return _dbPath
}

export function openDatabase(customPath?: string): Database.Database {
  const dbPath = customPath || path.join(app.getPath('userData'), 'dashboard.db')
  _dbPath = dbPath

  // Ensure directory exists
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Lock file
  const lockPath = dbPath + '.lock'
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    console.warn(`[DB] Lock file exists from PID ${lock.pid} at ${lock.time}`)
    // Don't block — just warn (UI will show a banner via IPC if needed)
  }
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }))

  const db = new Database(dbPath)
  initializeDatabase(db)
  _db = db
  return db
}

export function closeDatabase(): void {
  if (_db) {
    _db.close()
    _db = null
    const lockPath = _dbPath + '.lock'
    if (fs.existsSync(lockPath)) {
      try { fs.unlinkSync(lockPath) } catch { /* ignore */ }
    }
  }
}
