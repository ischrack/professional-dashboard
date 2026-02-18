import { ipcMain } from 'electron'
import { getDb } from '../db'
import { prunePostSessions } from '../db/schema'
import { IPC } from '../../shared/types'
import type { PostSession, PostSource } from '../../shared/types'
import * as cheerio from 'cheerio'
import path from 'path'
import { getEncryptedKey } from './settings'

export function registerPostHandlers(): void {
  ipcMain.handle(IPC.POST_GET_SESSIONS, () => {
    const db = getDb()
    const rows = db.prepare(
      `SELECT id, title, paper_title, paper_authors, current_post, word_count,
              created_at as createdAt, updated_at as updatedAt
       FROM post_sessions ORDER BY updated_at DESC LIMIT 50`
    ).all() as PostSession[]
    return rows
  })

  ipcMain.handle(IPC.POST_GET_SESSION, (_evt, id: number) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM post_sessions WHERE id=?').get(id) as (PostSession & { messages: string; sources: string; source_url?: string; source_text?: string; paper_title?: string; paper_authors?: string; paper_journal?: string; paper_abstract?: string }) | undefined
    if (!row) return null
    let sources: PostSource[] = JSON.parse(row.sources || '[]')
    // Legacy reconstruction: if no sources saved, build from old fields
    if (!sources.length && (row.source_url || row.source_text)) {
      sources = [{
        id: '0',
        role: 'primary',
        type: row.source_url ? 'url' : 'text',
        url: row.source_url || undefined,
        text: row.source_text || undefined,
        preview: row.paper_title ? {
          title: row.paper_title || '',
          authors: row.paper_authors || '',
          journal: row.paper_journal || '',
          abstract: row.paper_abstract || '',
        } : undefined,
      }]
    }
    return {
      ...row,
      sources,
      messages: JSON.parse(row.messages || '[]'),
    }
  })

  ipcMain.handle(IPC.POST_SAVE_SESSION, (_evt, session: Partial<PostSession>) => {
    const db = getDb()
    const messages = JSON.stringify(session.messages || [])
    const sources = JSON.stringify(session.sources || [])
    // Derive legacy fields from primary source for backward compat
    const primary = session.sources?.find(s => s.role === 'primary')
    const sourceUrl = primary?.url || session.sourceUrl || null
    const sourceText = primary?.text || session.sourceText || null
    const paperTitle = primary?.preview?.title || session.paperTitle || null
    const paperAuthors = primary?.preview?.authors || session.paperAuthors || null
    const paperJournal = primary?.preview?.journal || session.paperJournal || null
    const paperAbstract = primary?.preview?.abstract || session.paperAbstract || null

    const title = session.title || null

    if (session.id) {
      db.prepare(`
        UPDATE post_sessions SET
          title=?, source_url=?, source_text=?, paper_title=?, paper_authors=?, paper_journal=?,
          paper_abstract=?, current_post=?, messages=?, sources=?, word_count=?, updated_at=datetime('now')
        WHERE id=?
      `).run(
        title, sourceUrl, sourceText, paperTitle, paperAuthors, paperJournal,
        paperAbstract, session.currentPost || '', messages, sources,
        session.wordCount || 0, session.id
      )
      prunePostSessions(db, 50)
      return session.id
    } else {
      const result = db.prepare(`
        INSERT INTO post_sessions (title, source_url, source_text, paper_title, paper_authors, paper_journal, paper_abstract, current_post, messages, sources, word_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        title, sourceUrl, sourceText, paperTitle, paperAuthors, paperJournal,
        paperAbstract, session.currentPost || '', messages, sources,
        session.wordCount || 0
      )
      prunePostSessions(db, 50)
      return result.lastInsertRowid
    }
  })

  ipcMain.handle(IPC.POST_DELETE_SESSION, (_evt, id: number) => {
    const db = getDb()
    db.prepare('DELETE FROM post_sessions WHERE id=?').run(id)
    return true
  })

  ipcMain.handle(IPC.POST_FETCH_URL, async (_evt, url: string) => {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; academic-reader/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15000),
      })
      const html = await response.text()
      const $ = cheerio.load(html)

      // Try to extract structured metadata
      const title =
        $('meta[name="citation_title"]').attr('content') ||
        $('meta[property="og:title"]').attr('content') ||
        $('h1').first().text().trim() ||
        $('title').text().trim()

      const authors =
        $('meta[name="citation_author"]').map((_, el) => $(el).attr('content')).get().join(', ') ||
        $('meta[name="author"]').attr('content') ||
        ''

      const journal =
        $('meta[name="citation_journal_title"]').attr('content') ||
        $('meta[name="DC.source"]').attr('content') ||
        ''

      const abstract =
        $('meta[name="description"]').attr('content') ||
        $('section.abstract, #abstract, .abstract-content').text().trim() ||
        $('[class*="abstract"]').first().text().trim() ||
        ''

      // Try to get DOI
      const doi =
        $('meta[name="citation_doi"]').attr('content') ||
        $('meta[name="dc.identifier"]').attr('content') ||
        ''

      // Get main article text as fallback
      $('script, style, nav, header, footer').remove()
      const bodyText = $('article, main, .article-body, #main-content').first().text().trim() ||
        $('body').text().trim()

      return {
        success: true,
        title: title.trim(),
        authors: authors.trim(),
        journal: journal.trim(),
        abstract: abstract.slice(0, 2000).trim(),
        doi: doi.trim(),
        bodyText: bodyText.slice(0, 5000).trim(),
        url,
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle(IPC.POST_PARSE_PDF, async (_evt, filePath: string) => {
    try {
      // pdfjs-dist is renderer-side only; we read the file and return the buffer
      const fs = await import('fs')
      const buffer = fs.readFileSync(filePath)
      return { success: true, buffer: buffer.toString('base64'), filePath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
