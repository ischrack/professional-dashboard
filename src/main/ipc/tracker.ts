import { ipcMain } from 'electron'
import { getDb } from '../db'
import { IPC } from '../../shared/types'
import type { TrackerEntry } from '../../shared/types'

export function registerTrackerHandlers(): void {
  ipcMain.handle(IPC.TRACKER_GET_ALL, () => {
    const db = getDb()
    return db.prepare(`
      SELECT j.id, j.company, j.title, j.location, j.remote, j.salary_range as salary,
             j.applied_at as appliedAt, j.application_source as source, j.status,
             j.updated_at as lastUpdated
      FROM jobs j
      WHERE j.applied_at IS NOT NULL
      ORDER BY j.applied_at DESC
    `).all() as TrackerEntry[]
  })

  ipcMain.handle(IPC.TRACKER_UPDATE_STATUS, (_evt, jobId: number, status: string) => {
    const db = getDb()
    db.prepare(`UPDATE jobs SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, jobId)
    return true
  })

  ipcMain.handle(IPC.TRACKER_DELETE, (_evt, jobId: number) => {
    const db = getDb()
    db.prepare('DELETE FROM jobs WHERE id=?').run(jobId)
    return true
  })
}
