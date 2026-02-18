import { ipcMain } from 'electron'
import { getDb } from '../db'
import { IPC } from '../../shared/types'
import type { Paper, SearchProfile } from '../../shared/types'
import fetch from 'node-fetch'
import * as cheerio from 'cheerio'
import fs from 'fs'
import { getEncryptedKey } from './settings'

const PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

async function fetchPubmedForProfile(profile: SearchProfile, apiKey: string): Promise<Paper[]> {
  const terms = [
    ...profile.keywords.map((k) => `${k}[Title/Abstract]`),
    ...profile.meshTerms.map((m) => `${m}[MeSH Terms]`),
    ...profile.authors.map((a) => `${a}[Author]`),
  ].join(' OR ')

  if (!terms) return []

  const searchUrl = `${PUBMED_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(terms)}&retmax=50&sort=pub+date&retmode=json${apiKey ? `&api_key=${apiKey}` : ''}`
  const searchRes = await fetch(searchUrl)
  const searchData = (await searchRes.json()) as { esearchresult: { idlist: string[] } }
  const ids = searchData.esearchresult?.idlist || []
  if (!ids.length) return []

  const fetchUrl = `${PUBMED_BASE}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&rettype=abstract&retmode=xml${apiKey ? `&api_key=${apiKey}` : ''}`
  const fetchRes = await fetch(fetchUrl)
  const xmlText = await fetchRes.text()
  const $ = cheerio.load(xmlText, { xmlMode: true })

  const papers: Paper[] = []
  $('PubmedArticle').each((_, el) => {
    const pmid = $(el).find('PMID').first().text()
    const doi = $(el).find('ArticleId[IdType="doi"]').text()
    const title = $(el).find('ArticleTitle').text()
    const abstract = $(el).find('AbstractText').map((__, a) => $(a).text()).get().join(' ')
    const journal = $(el).find('Journal > Title').text()
    const year = parseInt($(el).find('PubDate > Year').text() || '0')
    const authors = $(el).find('Author').map((__, a) => {
      const ln = $(a).find('LastName').text()
      const fn = $(a).find('ForeName').text()
      return fn ? `${fn} ${ln}` : ln
    }).get().slice(0, 6).join(', ')

    if (!title) return

    papers.push({
      id: 0,
      pmid,
      doi: doi || undefined,
      title,
      authors,
      journal,
      year,
      abstract,
      profileIds: [profile.id],
      profileNames: [profile.name],
      isRead: false,
      isStarred: false,
      source: 'pubmed',
      addedAt: new Date().toISOString(),
      publishedAt: year ? `${year}-01-01` : '',
    })
  })

  return papers
}

export function registerPaperHandlers(): void {
  ipcMain.handle(IPC.PAPER_GET_ALL, (_evt, filters?: Record<string, unknown>) => {
    const db = getDb()
    let sql = `
      SELECT p.*, GROUP_CONCAT(sp.name, ', ') as profile_names_str
      FROM papers p
      LEFT JOIN paper_profiles pp ON p.id = pp.paper_id
      LEFT JOIN search_profiles sp ON pp.profile_id = sp.id
      GROUP BY p.id
      ORDER BY p.added_at DESC
    `
    const rows = db.prepare(sql).all() as (Paper & { profile_names_str: string; profile_ids: string })[]
    return rows.map((r) => ({
      ...r,
      profileIds: r.profile_ids ? JSON.parse(r.profile_ids) : [],
      profileNames: r.profile_names_str ? r.profile_names_str.split(', ') : [],
    }))
  })

  ipcMain.handle(IPC.PAPER_GET_BY_ID, (_evt, id: number) => {
    const db = getDb()
    return db.prepare('SELECT * FROM papers WHERE id=?').get(id) as Paper
  })

  ipcMain.handle(IPC.PAPER_ADD_MANUAL, async (_evt, doiOrPmid: string) => {
    const db = getDb()
    const apiKey = getEncryptedKey('pubmedKey')
    let paper: Partial<Paper> = {}

    if (doiOrPmid.startsWith('10.')) {
      // DOI lookup via PubMed
      const url = `${PUBMED_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(doiOrPmid)}[doi]&retmode=json${apiKey ? `&api_key=${apiKey}` : ''}`
      const res = await fetch(url)
      const data = (await res.json()) as { esearchresult: { idlist: string[] } }
      const pmid = data.esearchresult?.idlist?.[0]
      if (pmid) {
        // Then fetch by PMID
        const papers = await fetchPubmedForProfile({ id: 0, name: 'manual', keywords: [pmid], meshTerms: [], authors: [], journals: [], createdAt: '' }, apiKey)
        if (papers.length > 0) paper = papers[0]
      } else {
        paper = { doi: doiOrPmid, title: doiOrPmid }
      }
    } else {
      // Treat as PMID
      const fetchUrl = `${PUBMED_BASE}/efetch.fcgi?db=pubmed&id=${doiOrPmid}&rettype=abstract&retmode=xml${apiKey ? `&api_key=${apiKey}` : ''}`
      const res = await fetch(fetchUrl)
      const xml = await res.text()
      const $ = cheerio.load(xml, { xmlMode: true })
      const el = $('PubmedArticle').first()
      paper = {
        pmid: doiOrPmid,
        title: el.find('ArticleTitle').text(),
        abstract: el.find('AbstractText').text(),
        journal: el.find('Journal > Title').text(),
        year: parseInt(el.find('PubDate > Year').text() || '0'),
        authors: el.find('Author').map((_, a) => `${$(a).find('ForeName').text()} ${$(a).find('LastName').text()}`).get().slice(0, 6).join(', '),
        source: 'pubmed',
      }
    }

    const existing = paper.doi ? db.prepare('SELECT id FROM papers WHERE doi=?').get(paper.doi) : null
    if (existing) return { error: 'Paper already exists', id: (existing as { id: number }).id }

    const result = db.prepare(`
      INSERT OR IGNORE INTO papers (pmid, doi, title, authors, journal, year, abstract, source, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', datetime('now'))
    `).run(paper.pmid || null, paper.doi || null, paper.title || '', paper.authors || '', paper.journal || '', paper.year || null, paper.abstract || '')
    return { id: result.lastInsertRowid }
  })

  ipcMain.handle(IPC.PAPER_UPDATE, (_evt, id: number, updates: Partial<Paper>) => {
    const db = getDb()
    const fields = Object.entries(updates)
      .filter(([k]) => !['id', 'profileIds', 'profileNames'].includes(k))
      .map(([k]) => {
        const col = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
        return `${col}=?`
      })
    const values = Object.entries(updates)
      .filter(([k]) => !['id', 'profileIds', 'profileNames'].includes(k))
      .map(([, v]) => v)
    if (fields.length === 0) return false
    db.prepare(`UPDATE papers SET ${fields.join(', ')} WHERE id=?`).run(...values, id)
    return true
  })

  ipcMain.handle(IPC.PAPER_DELETE, (_evt, id: number) => {
    const db = getDb()
    db.prepare('DELETE FROM papers WHERE id=?').run(id)
    return true
  })

  ipcMain.handle(IPC.PAPER_FETCH_PUBMED, async () => {
    const db = getDb()
    const apiKey = getEncryptedKey('pubmedKey')
    const profiles = db.prepare('SELECT * FROM search_profiles').all() as SearchProfile[]
    let totalAdded = 0

    for (const profile of profiles) {
      const parsedProfile: SearchProfile = {
        ...profile,
        keywords: JSON.parse((profile as unknown as { keywords: string }).keywords || '[]'),
        meshTerms: JSON.parse((profile as unknown as { mesh_terms: string }).mesh_terms || '[]'),
        authors: JSON.parse((profile as unknown as { authors: string }).authors || '[]'),
        journals: JSON.parse((profile as unknown as { journals: string }).journals || '[]'),
      }
      try {
        const papers = await fetchPubmedForProfile(parsedProfile, apiKey)
        for (const p of papers) {
          const existing = p.doi
            ? db.prepare('SELECT id FROM papers WHERE doi=?').get(p.doi)
            : p.pmid
            ? db.prepare('SELECT id FROM papers WHERE pmid=?').get(p.pmid)
            : null
          if (existing) {
            // Add profile association if missing
            const pid = (existing as { id: number }).id
            db.prepare('INSERT OR IGNORE INTO paper_profiles (paper_id, profile_id) VALUES (?, ?)').run(pid, profile.id)
            continue
          }
          const result = db.prepare(`
            INSERT OR IGNORE INTO papers (pmid, doi, title, authors, journal, year, abstract, source, added_at, published_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pubmed', datetime('now'), ?)
          `).run(p.pmid || null, p.doi || null, p.title, p.authors, p.journal, p.year || null, p.abstract, p.publishedAt || null)
          if (result.lastInsertRowid) {
            db.prepare('INSERT OR IGNORE INTO paper_profiles (paper_id, profile_id) VALUES (?, ?)').run(result.lastInsertRowid, profile.id)
            totalAdded++
          }
        }
      } catch (err) {
        console.error(`Failed to fetch PubMed for profile ${profile.name}:`, err)
      }
    }

    return { added: totalAdded }
  })

  ipcMain.handle(IPC.PAPER_GET_PROFILES, () => {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM search_profiles ORDER BY name').all() as SearchProfile[]
    return rows.map((r) => ({
      ...r,
      keywords: JSON.parse((r as unknown as { keywords: string }).keywords || '[]'),
      meshTerms: JSON.parse((r as unknown as { mesh_terms: string }).mesh_terms || '[]'),
      authors: JSON.parse((r as unknown as { authors: string }).authors || '[]'),
      journals: JSON.parse((r as unknown as { journals: string }).journals || '[]'),
    }))
  })

  ipcMain.handle(IPC.PAPER_SAVE_PROFILE, (_evt, profile: Partial<SearchProfile>) => {
    const db = getDb()
    const kw = JSON.stringify(profile.keywords || [])
    const mesh = JSON.stringify(profile.meshTerms || [])
    const auth = JSON.stringify(profile.authors || [])
    const jour = JSON.stringify(profile.journals || [])
    if (profile.id) {
      db.prepare('UPDATE search_profiles SET name=?, keywords=?, mesh_terms=?, authors=?, journals=? WHERE id=?')
        .run(profile.name, kw, mesh, auth, jour, profile.id)
      return profile.id
    }
    const result = db.prepare('INSERT INTO search_profiles (name, keywords, mesh_terms, authors, journals) VALUES (?, ?, ?, ?, ?)')
      .run(profile.name, kw, mesh, auth, jour)
    return result.lastInsertRowid
  })

  ipcMain.handle(IPC.PAPER_DELETE_PROFILE, (_evt, id: number) => {
    const db = getDb()
    db.prepare('DELETE FROM search_profiles WHERE id=?').run(id)
    return true
  })

  ipcMain.handle(IPC.PAPER_LINK_PDF, (_evt, paperId: number, filePath: string) => {
    const db = getDb()
    db.prepare('UPDATE papers SET pdf_path=? WHERE id=?').run(filePath, paperId)
    return true
  })

  ipcMain.handle(IPC.PAPER_CHECK_PDF_PATH, (_evt, filePath: string) => {
    return fs.existsSync(filePath)
  })
}
