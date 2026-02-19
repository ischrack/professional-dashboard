import { ipcMain, session, app } from 'electron'
import { getDb } from '../db'
import { IPC } from '../../shared/types'
import type { Job, ApplicationMaterial, QAEntry } from '../../shared/types'
import { getMainWindow, getLinkedinView } from '../index'
import Imap from 'imap'
import { simpleParser } from 'mailparser'
import * as cheerio from 'cheerio'
import { getEncryptedKey } from './settings'
import path from 'path'
import fs from 'fs'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, convertInchesToTwip
} from 'docx'

// ── LLM description cleanup ──────────────────────────────────────────────────
// Strips nav/footer/UI junk from raw extracted text. Only runs if Anthropic key is set.

async function cleanDescriptionWithLlm(raw: string): Promise<string> {
  if (raw.length <= 200) return raw
  const apiKey = getEncryptedKey('anthropicKey')
  if (!apiKey) return raw
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `The following is extracted text from a LinkedIn job posting. Extract and return only the job description content — responsibilities, qualifications, and requirements. Remove any navigation text, footer text, promotional content, or UI elements. Return clean plain text with logical line breaks.\n\n${raw.slice(0, 8000)}`
      }]
    })
    const cleaned = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    return cleaned || raw
  } catch {
    return raw
  }
}

export function registerJobHandlers(): void {
  // ── CRUD ────────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.JOB_GET_ALL, () => {
    const db = getDb()
    return db.prepare('SELECT * FROM jobs ORDER BY added_at DESC').all() as Job[]
  })

  ipcMain.handle(IPC.JOB_GET_BY_ID, (_evt, id: number) => {
    const db = getDb()
    return db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as Job
  })

  ipcMain.handle(IPC.JOB_ADD, (_evt, job: Partial<Job>) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO jobs (company, title, location, remote, url, description, status, source, added_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      job.company || '',
      job.title || '',
      job.location || null,
      job.remote || null,
      job.url || null,
      job.description || null,
      job.status || (job.url ? 'needs_enrichment' : 'no_response'),
      job.source || 'manual'
    )
    return result.lastInsertRowid
  })

  ipcMain.handle(IPC.JOB_UPDATE, (_evt, id: number, updates: Partial<Job>) => {
    const db = getDb()
    const allowed = ['company', 'title', 'location', 'remote', 'url', 'description', 'salary',
      'job_type', 'seniority_level', 'status', 'source', 'applied_at', 'salary_range',
      'application_source', 'logo_url', 'company_research', 'easy_apply', 'num_applicants']
    const fields = Object.entries(updates)
      .filter(([k]) => allowed.includes(k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)))
      .map(([k]) => `${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}=?`)
    const values = Object.entries(updates)
      .filter(([k]) => allowed.includes(k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)))
      .map(([, v]) => v)
    if (!fields.length) return false
    db.prepare(`UPDATE jobs SET ${fields.join(', ')}, updated_at=datetime('now') WHERE id=?`).run(...values, id)
    return true
  })

  ipcMain.handle(IPC.JOB_DELETE, (_evt, id: number) => {
    const db = getDb()
    db.prepare('DELETE FROM jobs WHERE id=?').run(id)
    return true
  })

  // ── URL Preview ─────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.JOB_PREVIEW_URL, async (_evt, url: string) => {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; job-preview/1.0)', Accept: 'text/html' },
        signal: AbortSignal.timeout(10000),
      })
      const html = await response.text()
      const $ = cheerio.load(html)
      const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || ''
      let jobTitle = ''
      let company = ''
      const liMatch = ogTitle.match(/^(.+?)\s+[-–]\s+(.+?)\s*\|/)
      if (liMatch) {
        jobTitle = liMatch[1].trim()
        company = liMatch[2].trim()
      } else {
        jobTitle = ogTitle || $('h1').first().text().trim()
        company = $('meta[property="og:site_name"]').attr('content') ||
                  $('[class*="company"], [class*="employer"]').first().text().trim() || ''
      }
      return { jobTitle: jobTitle || undefined, company: company || undefined }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── IMAP ────────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.JOB_IMAP_TEST, async () => {
    const settings = loadImapSettings()
    return testImapConnection(settings)
  })

  ipcMain.handle(IPC.JOB_IMAP_TEST_PARSING, async () => {
    const settings = loadImapSettings()
    return fetchRecentEmailDiagnostics(settings, 5)
  })

  ipcMain.handle(IPC.JOB_IMAP_POLL, async () => {
    const settings = loadImapSettings()
    const forwardingAddress = settings.forwardingAddress
    if (!settings.host || !settings.user || !settings.pass) {
      return { error: 'IMAP not configured' }
    }
    const emails = await fetchLinkedInAlertEmails(settings, forwardingAddress)
    const db = getDb()
    let added = 0
    for (const email of emails) {
      for (const job of email.jobs) {
        const existing = job.url ? db.prepare('SELECT id FROM jobs WHERE url=?').get(job.url) : null
        if (existing) continue
        db.prepare(`
          INSERT INTO jobs (company, title, location, url, status, source, added_at, updated_at)
          VALUES (?, ?, ?, ?, 'needs_enrichment', 'linkedin_email', datetime('now'), datetime('now'))
        `).run(job.company, job.title, job.location || null, job.url || null)
        added++
      }
    }
    return { added }
  })

  // ── LinkedIn Enrichment ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.JOB_ENRICH, async (_evt, jobIds: number[]) => {
    if (jobIds.length > 10) {
      return { error: 'Maximum 10 jobs per enrichment batch' }
    }
    const db = getDb()
    const results: Record<number, { success: boolean; error?: string }> = {}
    const view = getLinkedinView()
    if (!view) return { error: 'Embedded browser not available' }

    for (const jobId of jobIds) {
      const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId) as Job
      if (!job?.url) {
        results[jobId] = { success: false, error: 'No URL' }
        continue
      }

      let enriched = false
      let authFailed = false

      // ── Primary: server-side fetch with LinkedIn session cookies ─────────────
      // LinkedIn SSR renders the full job description in initial HTML —
      // no IntersectionObserver / hidden-viewport issues.
      try {
        const sess = session.fromPartition('persist:linkedin')
        const cookies = await sess.cookies.get({ domain: '.linkedin.com' })
        // li_at is LinkedIn's main session cookie — present only when logged in
        const liAt = cookies.find((c) => c.name === 'li_at')
        if (liAt) {
          const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
          const fetchResp = await fetch(job.url, {
            headers: {
              'Cookie': cookieHeader,
              'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': 'https://www.linkedin.com/',
            },
            signal: AbortSignal.timeout(15000),
            redirect: 'follow',
          })

          // Detect auth redirect
          const fetchFinalUrl = fetchResp.url
          if (/\/(login|authwall|checkpoint\/challenge)/.test(fetchFinalUrl)) {
            authFailed = true
            db.prepare(`UPDATE jobs SET status='enrichment_failed', updated_at=datetime('now') WHERE id=?`).run(jobId)
            results[jobId] = { success: false, error: 'LinkedIn authentication required — open Settings → LinkedIn to log in' }
          } else {
            const html = await fetchResp.text()
            const $ = cheerio.load(html)

            // Title-based auth wall check
            const pageTitle = $('title').text()
            if (/log\s*in|sign\s*in/i.test(pageTitle) && !/job|engineer|developer|analyst|manager|director|coordinator/i.test(pageTitle)) {
              authFailed = true
              db.prepare(`UPDATE jobs SET status='enrichment_failed', updated_at=datetime('now') WHERE id=?`).run(jobId)
              results[jobId] = { success: false, error: 'LinkedIn authentication required — open Settings → LinkedIn to log in' }
            } else {
              let description: string | null = null
              let salary: string | null = null
              let seniority: string | null = null
              let jobType: string | null = null
              let numApplicants: number | null = null
              let easyApply = false

              // Strategy 1: JSON-LD schema.org JobPosting (most reliable in SSR)
              $('script[type="application/ld+json"]').each((_i, el) => {
                if (description) return
                try {
                  const jsonData = JSON.parse($(el).html() || '{}')
                  const arr = Array.isArray(jsonData) ? jsonData : [jsonData]
                  for (const d of arr) {
                    if (d['@type'] === 'JobPosting' && d.description) {
                      // description may be HTML — strip tags with cheerio
                      description = cheerio.load(d.description).text().trim() || String(d.description)
                      if (d.baseSalary?.value) {
                        const bsv = d.baseSalary.value
                        salary = [bsv.minValue, bsv.maxValue].filter(Boolean).join('–') +
                                 (d.baseSalary.currency ? ` ${d.baseSalary.currency}` : '')
                      }
                      if (d.employmentType) {
                        jobType = Array.isArray(d.employmentType) ? d.employmentType.join(', ') : String(d.employmentType)
                      }
                      break
                    }
                  }
                } catch { /* ignore */ }
              })
              console.log(`[enrich] job ${jobId}: JSON-LD → ${description ? description.length + ' chars' : 'not found'}`)

              // Strategy 2: SSR HTML selectors (LinkedIn renders full text server-side)
              if (!description) {
                const descSelectors = [
                  '.show-more-less-html__markup',
                  '.description__text',
                  '#job-details',
                  '[class*="job-description"]',
                  '.jobs-description__content',
                  '.description__text--rich',
                ]
                for (const sel of descSelectors) {
                  const el = $(sel)
                  if (el.length) {
                    const txt = el.text().trim()
                    if (txt.length > 100) {
                      description = txt
                      console.log(`[enrich] job ${jobId}: SSR "${sel}" → ${txt.length} chars`)
                      break
                    }
                  }
                }
              }

              // Header / criteria fields
              salary = salary || $('[class*="salary"], .compensation__salary-range').first().text().trim() || null
              seniority = $('[class*="seniority"], .description__job-criteria-text').first().text().trim() || null
              jobType = jobType || $('[class*="employment-type"], [class*="job-type"]').first().text().trim() || null
              const applicantsText = $('[class*="num-applicant"], [class*="applicant-count"]').first().text().trim()
              numApplicants = applicantsText ? parseInt(applicantsText.replace(/\D/g, '')) || null : null
              easyApply = $('[class*="easy-apply"]').length > 0

              if (description) {
                console.log(`[enrich] job ${jobId}: raw description (first 300 chars): ${description.slice(0, 300)}`)
                const cleanedDesc = await cleanDescriptionWithLlm(description)
                console.log(`[enrich] job ${jobId}: cleaned description (first 300 chars): ${cleanedDesc.slice(0, 300)}`)
                db.prepare(`
                  UPDATE jobs SET description=?, salary=?, seniority_level=?, job_type=?,
                  num_applicants=?, easy_apply=?, status='no_response', updated_at=datetime('now')
                  WHERE id=?
                `).run(cleanedDesc, salary || null, seniority || null, jobType || null,
                       numApplicants, easyApply ? 1 : 0, jobId)
                results[jobId] = { success: true }
                enriched = true
              }
            }
          }
        }
      } catch (serverErr) {
        console.log(`[enrich] job ${jobId}: server-side fetch error:`, serverErr)
      }

      // ── Fallback: WebContentsView targeted DOM extraction ────────────────────
      // Loads the page in a hidden browser, clicks expand, then extracts the
      // 'About the job' section directly rather than relying on body.innerText.
      if (!enriched && !authFailed) {
        try {
          await view.webContents.loadURL(job.url)
          // Initial wait for LinkedIn's React shell to render
          await new Promise((r) => setTimeout(r, 3500))

          // Auth wall check after navigation
          const wcFinalUrl = view.webContents.getURL()
          if (/\/(login|authwall|checkpoint\/challenge)/.test(wcFinalUrl)) {
            authFailed = true
            db.prepare(`UPDATE jobs SET status='enrichment_failed', updated_at=datetime('now') WHERE id=?`).run(jobId)
            results[jobId] = { success: false, error: 'LinkedIn authentication required — open Settings → LinkedIn to log in' }
          } else {
            // Single async IIFE: expand then extract with 1500ms wait between
            type DomResult = {
              title: string | null; company: string | null; location: string | null
              salary: string | null; jobType: string | null; workplaceType: string | null
              applicantCount: string | null; description: string | null; descSource: string | null
              expandClicked: string | null
            }
            const domResult = await view.webContents.executeJavaScript(`
              (async function() {
                // ── Step 1: Find and click any expand/show-more button ─────────
                var expandClicked = null;

                // Text-content match (catches "…more", "...more", "Show more", etc.)
                var allEls = document.querySelectorAll('button, a, [role="button"], span[tabindex]');
                for (var i = 0; i < allEls.length && !expandClicked; i++) {
                  var txt = (allEls[i].innerText || '').trim();
                  var lower = txt.toLowerCase();
                  if (lower === 'show more' || lower === 'see more' || lower === 'show more description' ||
                      txt === '…more' || txt === '...more' || txt === '…' ||
                      /^[…\\.]{1,3}more$/i.test(txt)) {
                    allEls[i].click();
                    expandClicked = 'text:' + JSON.stringify(txt);
                  }
                }

                // aria-expanded=false with relevant label
                if (!expandClicked) {
                  var ariaEls = document.querySelectorAll('[aria-expanded="false"]');
                  for (var j = 0; j < ariaEls.length && !expandClicked; j++) {
                    var label = (ariaEls[j].getAttribute('aria-label') || '').toLowerCase();
                    if (/show|more|expand|description/.test(label)) {
                      ariaEls[j].click();
                      expandClicked = 'aria-expanded:' + label;
                    }
                  }
                }

                // Class-based selectors
                if (!expandClicked) {
                  var expandSelectors = [
                    '.show-more-less-html__button--more',
                    '.inline-show-more-text__button',
                    'button[class*="show-more"]',
                    '[data-tracking-control-name*="show-more"]',
                    '[data-tracking-control-name*="see_more"]',
                    '.jobs-description__footer-action',
                  ];
                  for (var s = 0; s < expandSelectors.length && !expandClicked; s++) {
                    var btn = document.querySelector(expandSelectors[s]);
                    if (btn) { btn.click(); expandClicked = 'class:' + expandSelectors[s]; }
                  }
                }

                console.log('[enrich-dom] expand click:', expandClicked || 'none found');

                // Wait for expand animation
                if (expandClicked) {
                  await new Promise(r => setTimeout(r, 1500));
                }

                // ── Step 2: Targeted extraction of 'About the job' section ────
                var description = null;
                var descSource = null;

                // Strategy A: Find heading with 'About the job' text, get its container
                var allEls2 = document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p');
                for (var h = 0; h < allEls2.length; h++) {
                  var hText = (allEls2[h].childNodes.length === 1 ? allEls2[h].innerText : '').trim();
                  if (hText === 'About the job' || hText === 'About the Job') {
                    var container = allEls2[h].closest('[class*="description"], [class*="job-description"], [class*="details"], section, article, [id*="job"]') || allEls2[h].parentElement;
                    if (container) {
                      var full = container.innerText.trim();
                      var idx = full.indexOf(hText);
                      var raw = idx !== -1 ? full.slice(idx + hText.length).trim() : full;
                      var cutoffs = ['Meet the team', 'People also viewed', 'Similar jobs', 'Show more jobs', 'LinkedIn members', 'About the company', 'Report job', 'Show less'];
                      for (var c = 0; c < cutoffs.length; c++) {
                        var ci = raw.indexOf(cutoffs[c]);
                        if (ci > 100) { raw = raw.slice(0, ci).trim(); break; }
                      }
                      if (raw.length > 100) { description = raw; descSource = 'heading:exact'; break; }
                    }
                  }
                }

                // Strategy B: CSS selectors targeting the description markup
                if (!description) {
                  var descSelectors = [
                    '.show-more-less-html__markup',
                    '#job-details',
                    '[class*="description"][class*="content"]',
                    '[class*="job-description"]',
                    '[class*="description__text"]',
                    '.jobs-description__content',
                    '[class*="description"]',
                    '[class*="details"]',
                  ];
                  for (var ds = 0; ds < descSelectors.length && !description; ds++) {
                    var descEl = document.querySelector(descSelectors[ds]);
                    if (descEl) {
                      var txt = descEl.innerText.trim();
                      // Must be substantial and not just a header/label
                      if (txt.length > 150 && txt.split('\\n').length > 3) {
                        description = txt;
                        descSource = 'selector:' + descSelectors[ds];
                      }
                    }
                  }
                }

                console.log('[enrich-dom] description source:', descSource || 'none', '| length:', description ? description.length : 0);
                if (description) {
                  console.log('[enrich-dom] raw description preview:', description.slice(0, 300));
                }

                // ── Step 3: Structured header fields ──────────────────────────
                function first(sels) {
                  for (var i = 0; i < sels.length; i++) {
                    var el = document.querySelector(sels[i]);
                    if (el) { var t = el.innerText.trim(); if (t && t.length < 300) return t; }
                  }
                  return null;
                }

                var title = first(['h1', '.job-title', '[class*="job-title"]']);
                var company = first(['[class*="company-name"]', 'a[class*="company"]', '[class*="employer"]', '.topcard__org-name-link']);
                var location = first(['[class*="location"]', '.job-location', '.topcard__flavor--bullet']);
                var salary = first(['[class*="salary"]', '[class*="compensation"]', '.job-details-jobs-unified-top-card__salary-info']);
                var jobType = first(['[class*="employment-type"]', '[class*="job-type"]']);
                var workplaceType = first(['[class*="workplace"]', '[class*="remote"]', '[class*="work-place"]']);
                var applicantCount = first(['[class*="num-applicant"]', '[class*="applicant-count"]', '.num-applicants__caption']);

                return { title, company, location, salary, jobType, workplaceType, applicantCount, description, descSource, expandClicked };
              })()
            `).catch(() => null) as DomResult | null

            console.log(`[enrich] job ${jobId}: DOM result — source: ${domResult?.descSource ?? 'none'}, desc length: ${domResult?.description?.length ?? 0}`)

            if (domResult?.description) {
              const rawDesc = domResult.description
              console.log(`[enrich] job ${jobId}: raw description (first 300): ${rawDesc.slice(0, 300)}`)
              const cleanedDesc = await cleanDescriptionWithLlm(rawDesc)
              console.log(`[enrich] job ${jobId}: cleaned description (first 300): ${cleanedDesc.slice(0, 300)}`)

              db.prepare(`
                UPDATE jobs SET description=?, salary=?, seniority_level=?, job_type=?,
                num_applicants=?, easy_apply=?, status='no_response', updated_at=datetime('now')
                WHERE id=?
              `).run(
                cleanedDesc,
                domResult.salary || null,
                null, // seniority not extracted in this path
                domResult.jobType || null,
                null, // applicantCount is a string here, skip parsing
                0,    // easyApply not extracted in this path
                jobId
              )
              results[jobId] = { success: true }
              enriched = true
            } else {
              db.prepare(`UPDATE jobs SET status='enrichment_failed', updated_at=datetime('now') WHERE id=?`).run(jobId)
              results[jobId] = { success: false, error: 'Could not find job description on page — the "About the job" section may not have loaded. Try opening the LinkedIn browser and logging in.' }
            }
          }
        } catch (err) {
          db.prepare(`UPDATE jobs SET status='enrichment_failed', updated_at=datetime('now') WHERE id=?`).run(jobId)
          results[jobId] = { success: false, error: String(err) }
        }
      }

      // Delay between jobs (short for server-side success, longer for WebContentsView)
      if (jobId !== jobIds[jobIds.length - 1]) {
        const delay = enriched && !authFailed ? 500 : Math.floor(Math.random() * 13000) + 2000
        await new Promise((r) => setTimeout(r, delay))
      }
    }

    return results
  })

  // ── Materials ────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.JOB_GET_MATERIAL, (_evt, jobId: number, type: string) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM application_materials WHERE job_id=? AND type=?').get(jobId, type) as ApplicationMaterial & { messages: string }
    if (!row) return null
    return { ...row, messages: JSON.parse(row.messages || '[]') }
  })

  ipcMain.handle(IPC.JOB_SAVE_MATERIAL, (_evt, material: Partial<ApplicationMaterial>) => {
    const db = getDb()
    const messages = JSON.stringify(material.messages || [])
    const existing = db.prepare('SELECT id FROM application_materials WHERE job_id=? AND type=?').get(material.jobId, material.type) as { id: number } | undefined
    if (existing) {
      db.prepare(`UPDATE application_materials SET content=?, messages=?, base_resume_id=?, updated_at=datetime('now') WHERE id=?`)
        .run(material.content || '', messages, material.baseResumeId || null, existing.id)
      return existing.id
    }
    const result = db.prepare(`
      INSERT INTO application_materials (job_id, type, content, messages, base_resume_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(material.jobId, material.type, material.content || '', messages, material.baseResumeId || null)
    return result.lastInsertRowid
  })

  // ── Q&A ──────────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.JOB_GET_QA, (_evt, jobId: number) => {
    const db = getDb()
    return db.prepare('SELECT * FROM qa_entries WHERE job_id=? ORDER BY created_at DESC').all(jobId) as QAEntry[]
  })

  ipcMain.handle(IPC.JOB_SAVE_QA, (_evt, entry: Partial<QAEntry>) => {
    const db = getDb()
    if (entry.id) {
      db.prepare('UPDATE qa_entries SET answer=?, char_limit=?, is_template=?, template_name=? WHERE id=?')
        .run(entry.answer || '', entry.charLimit || null, entry.isTemplate ? 1 : 0, entry.templateName || null, entry.id)
      return entry.id
    }
    const result = db.prepare(`
      INSERT INTO qa_entries (job_id, question, answer, char_limit, is_template, template_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(entry.jobId || null, entry.question || '', entry.answer || '', entry.charLimit || null, entry.isTemplate ? 1 : 0, entry.templateName || null)
    return result.lastInsertRowid
  })

  ipcMain.handle(IPC.JOB_DELETE_QA, (_evt, id: number) => {
    const db = getDb()
    db.prepare('DELETE FROM qa_entries WHERE id=?').run(id)
    return true
  })

  ipcMain.handle(IPC.JOB_GET_QA_TEMPLATES, () => {
    const db = getDb()
    return db.prepare('SELECT * FROM qa_entries WHERE is_template=1 ORDER BY template_name').all() as QAEntry[]
  })

  // ── Notes ────────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.JOB_GET_NOTES, (_evt, jobId: number) => {
    const db = getDb()
    const row = db.prepare('SELECT content FROM job_notes WHERE job_id=?').get(jobId) as { content: string } | undefined
    return row?.content || ''
  })

  ipcMain.handle(IPC.JOB_SAVE_NOTES, (_evt, jobId: number, content: string) => {
    const db = getDb()
    const existing = db.prepare('SELECT id FROM job_notes WHERE job_id=?').get(jobId)
    if (existing) {
      db.prepare(`UPDATE job_notes SET content=?, updated_at=datetime('now') WHERE job_id=?`).run(content, jobId)
    } else {
      db.prepare('INSERT INTO job_notes (job_id, content) VALUES (?, ?)').run(jobId, content)
    }
    return true
  })

  // ── Mark as Applied ───────────────────────────────────────────────────────────

  ipcMain.handle(IPC.JOB_MARK_APPLIED, (_evt, jobId: number, data: {
    appliedAt: string;
    salaryRange?: string;
    remote?: string;
    applicationSource?: string;
  }) => {
    const db = getDb()
    db.prepare(`
      UPDATE jobs SET applied_at=?, salary_range=?, remote=?, application_source=?,
      status='no_response', updated_at=datetime('now') WHERE id=?
    `).run(
      data.appliedAt,
      data.salaryRange || null,
      data.remote || null,
      data.applicationSource || 'LinkedIn',
      jobId
    )
    return true
  })

  // ── Company Page Research ─────────────────────────────────────────────────────

  ipcMain.handle(IPC.JOB_FETCH_COMPANY_PAGE, async (_evt, companyName: string, url?: string) => {
    const view = getLinkedinView()
    if (!view) return { error: 'Embedded browser not available' }

    const targetUrl = url || `https://${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com/about`
    try {
      await view.webContents.loadURL(targetUrl)
      await new Promise((r) => setTimeout(r, 3000))
      const text = await view.webContents.executeJavaScript(`
        document.body.innerText.replace(/\\s+/g, ' ').slice(0, 3000)
      `)
      return { success: true, text, url: targetUrl }
    } catch (err) {
      return { success: false, error: String(err), url: targetUrl }
    }
  })

  // ── Export ────────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.JOB_EXPORT_DOCX, async (_evt, jobId: number, type: 'resume' | 'cover_letter', htmlContent: string, lastName: string) => {
    const db = getDb()
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId) as Job
    if (!job) return { error: 'Job not found' }

    const fs = await import('fs')
    const settingsFile = path.join(app.getPath('userData'), 'settings.json')
    let outputFolder = app.getPath('documents')
    try {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
      outputFolder = settings.outputFolder || outputFolder
    } catch { /* use default */ }

    const date = new Date().toISOString().split('T')[0]
    const roleShort = job.title.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)
    const co = job.company.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)
    const dirName = `${job.company} — ${job.title} — ${date}`
    const dirPath = path.join(outputFolder, dirName)
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })

    const typeLabel = type === 'resume' ? 'Resume' : 'CoverLetter'
    const fileName = `${lastName}_${co}_${roleShort}_${typeLabel}.docx`
    const filePath = path.join(dirPath, fileName)

    // Parse HTML to docx paragraphs
    const paragraphs = parseHtmlToDocxParagraphs(htmlContent)
    const doc = new Document({ sections: [{ children: paragraphs }] })
    const buffer = await Packer.toBuffer(doc)
    fs.writeFileSync(filePath, buffer)

    return { success: true, filePath, dirPath }
  })

  ipcMain.handle(IPC.JOB_OPEN_FILE, async (_evt, filePath: string) => {
    const { shell } = await import('electron')
    await shell.openPath(filePath)
    return true
  })
}

// ── IMAP Helpers ─────────────────────────────────────────────────────────────

function loadImapSettings(): {
  host: string; port: number; user: string; pass: string; tls: boolean; forwardingAddress: string
} {
  const fs = require('fs')
  const path = require('path')
  const settingsFile = path.join(app.getPath('userData'), 'settings.json')
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    return {
      host: s.imapHost || 'imap.gmail.com',
      port: s.imapPort || 993,
      user: s.imapUser || '',
      pass: getEncryptedKey('imapPass'),
      tls: s.imapTls !== false,
      forwardingAddress: s.imapForwardingAddress || '',
    }
  } catch {
    return { host: 'imap.gmail.com', port: 993, user: '', pass: '', tls: true, forwardingAddress: '' }
  }
}

async function testImapConnection(settings: ReturnType<typeof loadImapSettings>): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const imap = new Imap({
      user: settings.user,
      password: settings.pass,
      host: settings.host,
      port: settings.port,
      tls: settings.tls,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
    })
    imap.once('ready', () => { imap.end(); resolve({ success: true }) })
    imap.once('error', (err: Error) => resolve({ success: false, error: err.message }))
    imap.connect()
  })
}

async function fetchRecentEmailDiagnostics(
  settings: ReturnType<typeof loadImapSettings>,
  count: number
): Promise<{ emails: Array<{ from: string; subject: string; forwardedTo?: string; originalFrom?: string; replyTo?: string }> }> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: settings.user,
      password: settings.pass,
      host: settings.host,
      port: settings.port,
      tls: settings.tls,
      tlsOptions: { rejectUnauthorized: false },
    })

    const emails: Array<{ from: string; subject: string; forwardedTo?: string; originalFrom?: string; replyTo?: string }> = []

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) { imap.end(); resolve({ emails }); return }
        const total = box.messages.total
        const start = Math.max(1, total - count + 1)
        const fetch = imap.seq.fetch(`${start}:${total}`, { bodies: 'HEADER', struct: true })

        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            let data = ''
            stream.on('data', (chunk: Buffer) => data += chunk.toString())
            stream.on('end', () => {
              const headers = Imap.parseHeader(data)
              emails.push({
                from: (headers.from?.[0] || ''),
                subject: (headers.subject?.[0] || ''),
                forwardedTo: headers['x-forwarded-to']?.[0],
                originalFrom: headers['x-original-from']?.[0],
                replyTo: headers['reply-to']?.[0],
              })
            })
          })
        })

        fetch.once('end', () => { imap.end(); resolve({ emails }) })
        fetch.once('error', () => { imap.end(); resolve({ emails }) })
      })
    })

    imap.once('error', (err: Error) => resolve({ emails }))
    imap.connect()
  })
}

async function fetchLinkedInAlertEmails(
  settings: ReturnType<typeof loadImapSettings>,
  forwardingAddress: string
): Promise<Array<{ subject: string; jobs: Array<{ title: string; company: string; location?: string; url?: string }> }>> {
  return new Promise((resolve) => {
    const imap = new Imap({
      user: settings.user,
      password: settings.pass,
      host: settings.host,
      port: settings.port,
      tls: settings.tls,
      tlsOptions: { rejectUnauthorized: false },
    })

    const results: Array<{ subject: string; jobs: Array<{ title: string; company: string; location?: string; url?: string }> }> = []

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); resolve(results); return }

        const criteria: string[][] = [['UNSEEN']]
        if (forwardingAddress) {
          criteria.push(['FROM', forwardingAddress])
        }

        imap.search(criteria, (err, uids) => {
          if (err || !uids.length) { imap.end(); resolve(results); return }

          const fetch = imap.fetch(uids, { bodies: '', markSeen: true })

          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              let raw = ''
              stream.on('data', (chunk: Buffer) => raw += chunk.toString())
              stream.on('end', async () => {
                try {
                  const parsed = await simpleParser(raw)
                  // Secondary confirmation: check headers for linkedin.com
                  const headers = parsed.headers
                  const fwdTo = (headers.get('x-forwarded-to') as string) || ''
                  const origFrom = (headers.get('x-original-from') as string) || ''
                  const replyTo = parsed.replyTo?.text || ''
                  const isLinkedIn = [fwdTo, origFrom, replyTo, parsed.from?.text || ''].some(h => h.includes('linkedin.com'))

                  if (!isLinkedIn && forwardingAddress) {
                    // Skip if not from LinkedIn even via forwarding
                    return
                  }

                  const jobs = parseLinkedInAlertHtml(parsed.html || parsed.text || '')
                  if (jobs.length > 0) {
                    results.push({ subject: parsed.subject || '', jobs })
                  }
                } catch { /* ignore parse errors */ }
              })
            })
          })

          fetch.once('end', () => { imap.end(); resolve(results) })
        })
      })
    })

    imap.once('error', () => resolve(results))
    imap.connect()
  })
}

function parseLinkedInAlertHtml(html: string): Array<{ title: string; company: string; location?: string; url?: string }> {
  const $ = cheerio.load(html)
  const jobs: Array<{ title: string; company: string; location?: string; url?: string }> = []

  // LinkedIn alert email structure
  $('table tr, .job-listing, [class*="job"]').each((_, el) => {
    const titleEl = $(el).find('a[href*="linkedin.com/jobs"], a[href*="jobs/view"]').first()
    const title = titleEl.text().trim()
    const url = titleEl.attr('href')?.split('?')[0]
    const company = $(el).find('[class*="company"], [class*="employer"]').first().text().trim()
    const location = $(el).find('[class*="location"], [class*="place"]').first().text().trim()
    if (title && company) jobs.push({ title, company, location: location || undefined, url })
  })

  // Fallback: look for any job links
  if (!jobs.length) {
    $('a[href*="linkedin.com/jobs/view"]').each((_, el) => {
      const url = $(el).attr('href')?.split('?')[0]
      const title = $(el).text().trim()
      if (title && url) jobs.push({ title, company: 'Unknown', url })
    })
  }

  return jobs
}

// ── HTML → docx conversion ────────────────────────────────────────────────────

function parseHtmlToDocxParagraphs(html: string): Paragraph[] {
  const $ = cheerio.load(html)
  const paragraphs: Paragraph[] = []

  $('body').children().each((_, el) => {
    const tag = (el as cheerio.Element & { tagName: string }).tagName?.toLowerCase()
    const text = $(el).text().trim()
    if (!text) return

    if (tag === 'h1') {
      paragraphs.push(new Paragraph({ text, heading: HeadingLevel.HEADING_1 }))
    } else if (tag === 'h2') {
      paragraphs.push(new Paragraph({ text, heading: HeadingLevel.HEADING_2 }))
    } else if (tag === 'h3') {
      paragraphs.push(new Paragraph({ text, heading: HeadingLevel.HEADING_3 }))
    } else if (tag === 'ul' || tag === 'ol') {
      $(el).find('li').each((_, li) => {
        paragraphs.push(new Paragraph({
          bullet: { level: 0 },
          children: parseInlineElements($, li),
        }))
      })
    } else {
      // p, div, span, etc.
      paragraphs.push(new Paragraph({ children: parseInlineElements($, el) }))
    }
  })

  return paragraphs.length ? paragraphs : [new Paragraph({ text: html.replace(/<[^>]+>/g, ' ').trim() })]
}

function parseInlineElements($: cheerio.CheerioAPI, el: cheerio.AnyNode): TextRun[] {
  const runs: TextRun[] = []
  $(el).contents().each((_, node) => {
    if (node.type === 'text') {
      const text = (node as cheerio.AnyNode & { data: string }).data
      if (text?.trim()) runs.push(new TextRun({ text }))
    } else if (node.type === 'tag') {
      const tag = (node as cheerio.AnyNode & { tagName: string }).tagName?.toLowerCase()
      const text = $(node).text()
      if (!text?.trim()) return
      if (tag === 'strong' || tag === 'b') {
        runs.push(new TextRun({ text, bold: true }))
      } else if (tag === 'em' || tag === 'i') {
        runs.push(new TextRun({ text, italics: true }))
      } else if (tag === 'u') {
        runs.push(new TextRun({ text, underline: {} }))
      } else {
        runs.push(new TextRun({ text }))
      }
    }
  })
  return runs.length ? runs : [new TextRun({ text: $(el).text() })]
}
