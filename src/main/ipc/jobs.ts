import { ipcMain, session, app, WebContentsView, BrowserWindow } from 'electron'
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
  Document, Packer, Paragraph, TextRun, AlignmentType, convertInchesToTwip
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

function normalizeDescriptionText(raw: string): string {
  let text = raw
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  text = text.replace(/^About (the|this) [Jj]ob\s*/, '').trim()

  const cutoffs = [
    'Meet the team',
    'People also viewed',
    'Similar jobs',
    'Show more jobs',
    'LinkedIn members',
    'About the company',
    'Report job',
    'Show less',
  ]

  for (const cutoff of cutoffs) {
    const idx = text.indexOf(cutoff)
    if (idx > 120) {
      text = text.slice(0, idx).trim()
      break
    }
  }

  return text
}

function isLikelyTruncatedDescription(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return true
  if (/[.…]{1,3}\s*more\b/i.test(t)) return true
  if (/\.\.\.\s*$/.test(t)) return true
  if (t.length < 220) return true
  return false
}

function isLikelyHeroSummary(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return true
  const lower = t.toLowerCase()

  const aboutSignals = [
    'about the job',
    'about this job',
    'about the role',
    'responsibilities',
    'qualifications',
    'requirements',
    'your contributions',
    'a good match',
    'benefits found in job post',
  ]
  const hasAboutSignals = aboutSignals.some(s => lower.includes(s))

  const heroSignals = [
    'people clicked apply',
    'responses managed off linkedin',
    'promoted by hirer',
    'reposted',
  ]
  const hasHeroSignals = heroSignals.some(s => lower.includes(s))
  const hasApplySave = /\bapply\b/i.test(t) && /\bsave\b/i.test(t)

  if (!hasAboutSignals && (hasHeroSignals || hasApplySave) && t.length < 900) return true
  return false
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function safeParseJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function selectorsFromPatternRows(rows: Array<{ selectors_json: string | null; chain_json: string | null }>): string[] {
  const selectors = new Set<string>()

  for (const row of rows) {
    const selParsed = safeParseJson(row.selectors_json)
    if (Array.isArray(selParsed)) {
      for (const s of selParsed) {
        if (typeof s === 'string' && s.trim()) selectors.add(s.trim())
      }
    }

    const chainParsed = safeParseJson(row.chain_json)
    if (Array.isArray(chainParsed)) {
      for (const node of chainParsed) {
        if (
          node &&
          typeof node === 'object' &&
          'selector' in node &&
          typeof (node as { selector: unknown }).selector === 'string'
        ) {
          const sel = (node as { selector: string }).selector.trim()
          if (sel) selectors.add(sel)
        }
      }
    }
  }

  return Array.from(selectors)
    .filter(s => s.length <= 300)
    .slice(0, 80)
}

async function clickLikelyExpandButtons(view: WebContentsView): Promise<number> {
  const clicked = await view.webContents.executeJavaScript(`
    (function() {
      const seen = new Set()
      let clicks = 0
      const nodes = document.querySelectorAll('button, a, [role="button"], [aria-expanded="false"], div[role="button"], span[role="button"], div[class], span[class]')
      for (const el of nodes) {
        const key = (el.tagName || '') + '|' + (el.id || '') + '|' + (el.className || '')
        if (seen.has(key)) continue
        seen.add(key)
        const txt = (el.innerText || '').trim().toLowerCase()
        const aria = ((el.getAttribute && el.getAttribute('aria-label')) || '').toLowerCase()
        const dataTrack = ((el.getAttribute && el.getAttribute('data-tracking-control-name')) || '').toLowerCase()
        if (
          txt === 'show more' ||
          txt === 'see more' ||
          txt === '...more' ||
          txt === '…more' ||
          txt === '... more' ||
          txt === '… more' ||
          txt === 'show more description' ||
          /^[…\\.]{1,3}\\s*more$/i.test(txt) ||
          /show|expand|more|description/.test(aria) ||
          /show-more|see_more|more/.test(dataTrack)
        ) {
          try { el.click(); clicks++ } catch {}
        }
      }
      return clicks
    })()
  `).catch(() => 0)
  return typeof clicked === 'number' ? clicked : 0
}

async function expandAboutSectionAndWait(view: WebContentsView): Promise<number> {
  const clicked = await view.webContents.executeJavaScript(`
    (async function() {
      function isMoreLike(el) {
        const txt = (el.innerText || '').trim().toLowerCase()
        const aria = ((el.getAttribute && el.getAttribute('aria-label')) || '').toLowerCase()
        return (
          txt === '...more' ||
          txt === '…more' ||
          txt === '... more' ||
          txt === '… more' ||
          txt === 'show more' ||
          txt === 'see more' ||
          txt === 'show more description' ||
          /^[…\\.]{1,3}\\s*more$/i.test(txt) ||
          ((txt.includes('more') || txt.includes('expand') || txt.includes('show')) && txt.length <= 32) ||
          /show|expand|more|description/.test(aria)
        )
      }

      const headingNodes = document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p')
      let heading = null
      for (const n of headingNodes) {
        const t = (n.innerText || '').trim().toLowerCase()
        if (
          t === 'about the job' ||
          t === 'about this job' ||
          t.startsWith('about the job') ||
          t.startsWith('about this job')
        ) {
          heading = n
          break
        }
      }

      if (heading && heading.scrollIntoView) {
        heading.scrollIntoView({ block: 'center', behavior: 'instant' })
        await new Promise(r => setTimeout(r, 180))
      }

      const roots = []
      if (heading) {
        const container = heading.closest('section,article,div') || heading.parentElement
        if (container) roots.push(container)
      }
      roots.push(document.body)

      let clicks = 0
      const seen = new WeakSet()
      for (let pass = 0; pass < 4; pass++) {
        for (const root of roots) {
          const nodes = root.querySelectorAll('button, a, [role="button"], [aria-expanded="false"], div, span')
          for (const el of nodes) {
            if (seen.has(el)) continue
            if (!isMoreLike(el)) continue
            seen.add(el)
            try { el.click(); clicks++ } catch {}
          }
        }
        await new Promise(r => setTimeout(r, 320))
      }
      return clicks
    })()
  `).catch(() => 0)
  return typeof clicked === 'number' ? clicked : 0
}

async function extractFromAboutSection(view: WebContentsView): Promise<string | null> {
  const result = await view.webContents.executeJavaScript(`
    (async function() {
      function normalize(raw) {
        let text = (raw || '')
          .replace(/\\r/g, '')
          .replace(/[ \\t]+\\n/g, '\\n')
          .replace(/[ \\t]{2,}/g, ' ')
          .trim()
        text = text.replace(/^About (the|this) [Jj]ob\\s*/, '').trim()
        const cutoffs = [
          'Meet the team',
          'People also viewed',
          'Similar jobs',
          'Show more jobs',
          'LinkedIn members',
          'About the company',
          'Report job',
          'Show less',
        ]
        for (const c of cutoffs) {
          const i = text.indexOf(c)
          if (i > 120) { text = text.slice(0, i).trim(); break }
        }
        return text
      }

      const headingNodes = document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p')
      let container = null
      for (const n of headingNodes) {
        const t = (n.innerText || '').trim().toLowerCase()
        if (
          t === 'about the job' ||
          t === 'about this job' ||
          t.startsWith('about the job') ||
          t.startsWith('about this job')
        ) {
          container = n.closest('section,article,div') || n.parentElement
          break
        }
      }
      if (!container) return null

      for (let i = 0; i < 3; i++) {
        const clickables = container.querySelectorAll('button, a, [role="button"], [aria-expanded="false"], div[role="button"], span[role="button"], div[class], span[class]')
        for (const el of clickables) {
          const txt = (el.innerText || '').trim().toLowerCase()
          const aria = ((el.getAttribute && el.getAttribute('aria-label')) || '').toLowerCase()
          if (
            txt === 'show more' ||
            txt === 'see more' ||
            txt === '...more' ||
            txt === '…more' ||
            txt === '... more' ||
            txt === '… more' ||
            txt === 'show more description' ||
            /^[…\\.]{1,3}\\s*more$/i.test(txt) ||
            /show|expand|more|description/.test(aria)
          ) {
            try { el.click() } catch {}
          }
        }
        await new Promise(r => setTimeout(r, 350))
      }

      const normalized = normalize(container.innerText || '')
      if (/[.…]{1,3}\\s*more\\b/i.test(normalized)) return null
      if (normalized.length < 180) return null
      return normalized
    })()
  `).catch(() => null)

  return typeof result === 'string' && result.trim() ? result : null
}

async function extractWithSavedSelectors(
  view: WebContentsView,
  selectors: string[],
): Promise<{ description: string | null; selector: string | null }> {
  if (!selectors.length) return { description: null, selector: null }

  const result = await view.webContents.executeJavaScript(`
    (async function(selectors) {
      function normalize(raw) {
        let text = (raw || '')
          .replace(/\\r/g, '')
          .replace(/[ \\t]+\\n/g, '\\n')
          .replace(/[ \\t]{2,}/g, ' ')
          .trim()
        text = text.replace(/^About (the|this) [Jj]ob\\s*/, '').trim()
        const cutoffs = [
          'Meet the team',
          'People also viewed',
          'Similar jobs',
          'Show more jobs',
          'LinkedIn members',
          'About the company',
          'Report job',
          'Show less',
        ]
        for (const c of cutoffs) {
          const i = text.indexOf(c)
          if (i > 120) { text = text.slice(0, i).trim(); break }
        }
        return text
      }

      function clickAround(node) {
        const root = node.closest('section,article,div') || node
        const clickables = root.querySelectorAll('button, a, [role="button"], [aria-expanded="false"], div[role="button"], span[role="button"], div[class], span[class]')
        for (const el of clickables) {
          const txt = (el.innerText || '').trim().toLowerCase()
          const aria = ((el.getAttribute && el.getAttribute('aria-label')) || '').toLowerCase()
          if (
            txt === 'show more' ||
            txt === 'see more' ||
            txt === '...more' ||
            txt === '…more' ||
            txt === '... more' ||
            txt === '… more' ||
            txt === 'show more description' ||
            /^[…\\.]{1,3}\\s*more$/i.test(txt) ||
            /show|expand|more|description/.test(aria)
          ) {
            try { el.click() } catch {}
          }
        }
      }

      for (const sel of selectors) {
        let nodes = []
        try { nodes = Array.from(document.querySelectorAll(sel)) } catch { continue }
        for (const n of nodes.slice(0, 4)) {
          clickAround(n)
          await new Promise(r => setTimeout(r, 250))
          const text = normalize((n.innerText || n.textContent || '').trim())
          if (text.length >= 180 && text.split('\\n').length >= 3) {
            return { description: text, selector: sel }
          }
        }
      }
      return { description: null, selector: null }
    })(${JSON.stringify(selectors)})
  `).catch(() => ({ description: null, selector: null }))

  if (!result || typeof result !== 'object') return { description: null, selector: null }
  const parsed = result as { description?: unknown; selector?: unknown }
  return {
    description: typeof parsed.description === 'string' ? parsed.description : null,
    selector: typeof parsed.selector === 'string' ? parsed.selector : null,
  }
}

function buildCompanyResearchTarget(companyName: string, url?: string): string | null {
  if (url) {
    try {
      const u = new URL(url)
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString()
    } catch {
      // ignore invalid supplied URL
    }
  }

  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  if (!slug) return null
  return `https://www.linkedin.com/company/${slug}/about/`
}

function extractDescriptionFromServerHtml(html: string): { description: string | null; source: string | null } {
  const $ = cheerio.load(html)
  let description: string | null = null
  let source: string | null = null

  // Strategy 1: JSON-LD JobPosting
  $('script[type="application/ld+json"]').each((_i, el) => {
    if (description) return
    try {
      const jsonData = JSON.parse($(el).html() || '{}')
      const arr = Array.isArray(jsonData) ? jsonData : [jsonData]
      for (const d of arr) {
        if (d['@type'] === 'JobPosting' && d.description) {
          description = cheerio.load(d.description).text().trim() || String(d.description)
          source = 'server:json-ld'
          break
        }
      }
    } catch { /* ignore */ }
  })

  // Strategy 2: SSR selectors
  if (!description) {
    const descSelectors = [
      '.show-more-less-html__markup',
      '.description__text',
      '#job-details',
      '._1ab93946',
      '[class*="job-description"]',
      '.jobs-description__content',
      '.description__text--rich',
    ]
    for (const sel of descSelectors) {
      const els = $(sel)
      if (!els.length) continue
      els.each((_i, el) => {
        if (description) return
        let txt = $(el).text().trim()
        if (txt.length < 100) return
        if (/^About the [Jj]ob/i.test(txt)) txt = txt.slice(13).trim()
        const cutoffs = ['Meet the team', 'People also viewed', 'Similar jobs', 'About the company', 'Report job', 'Show less']
        for (const cut of cutoffs) {
          const ci = txt.indexOf(cut)
          if (ci > 100) { txt = txt.slice(0, ci).trim(); break }
        }
        if (txt.length > 100) {
          description = txt
          source = `server:selector:${sel}`
        }
      })
      if (description) break
    }
  }

  // Strategy 3: text search
  if (!description) {
    $('div,section,article').each((_i, el) => {
      if (description) return
      let txt = $(el).text().trim()
      if (!(/^About the [Jj]ob/i.test(txt)) || txt.length < 100) return
      txt = txt.slice(13).trim()
      const cutoffs = ['Meet the team', 'People also viewed', 'Similar jobs', 'About the company', 'Report job', 'Show less']
      for (const cut of cutoffs) {
        const ci = txt.indexOf(cut)
        if (ci > 100) { txt = txt.slice(0, ci).trim(); break }
      }
      if (txt.length > 100) {
        description = txt
        source = 'server:text-search'
      }
    })
  }

  return { description, source }
}

async function extractFromBodyAboutText(view: WebContentsView): Promise<string | null> {
  const result = await view.webContents.executeJavaScript(`
    (function() {
      const bodyText = (document.body.innerText || '').replace(/[ \\t]+/g, ' ').trim()
      if (!bodyText) return null
      let idx = bodyText.indexOf('About the job')
      if (idx === -1) idx = bodyText.indexOf('About the Job')
      if (idx === -1) idx = bodyText.indexOf('About this job')
      if (idx === -1) idx = bodyText.indexOf('About this Job')
      if (idx === -1) return null
      let raw = bodyText.slice(idx).trim()
      const drop = ['Meet the team', 'People also viewed', 'Similar jobs', 'About the company', 'Report job', 'Show less']
      for (const marker of drop) {
        const at = raw.indexOf(marker)
        if (at > 100) { raw = raw.slice(0, at).trim(); break }
      }
      return raw
    })()
  `).catch(() => null)

  if (typeof result !== 'string' || !result.trim()) return null
  const normalized = normalizeDescriptionText(result)
  return normalized.length >= 180 ? normalized : null
}

type ExportMaterialType = 'resume' | 'cover_letter'
type ExportFormat = 'docx_formatted' | 'docx_minimal' | 'pdf_formatted'
type OverwriteStrategy = 'prompt' | 'overwrite' | 'new'
type ResumeLayoutPreset = 'ats_standard' | 'ats_compact' | 'ats_detailed'

type JobExportPayload = {
  jobId: number
  type: ExportMaterialType
  html: string
  baseFileName: string
  formats: ExportFormat[]
  overwriteStrategy?: OverwriteStrategy
  resumeLayoutPreset?: ResumeLayoutPreset
}

type DocxLayoutConfig = {
  font: string
  bodySize: number
  heading1Size: number
  heading2Size: number
  heading3Size: number
  nameSize: number
  contactSize: number
  sectionHeadingSize: number
  lineSpacing: number
  paragraphAfter: number
  bulletAfter: number
  margins: {
    top: number
    right: number
    bottom: number
    left: number
  }
}

function loadLocalSettings(): Record<string, unknown> {
  const settingsFile = path.join(app.getPath('userData'), 'settings.json')
  try {
    return JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
  } catch {
    return {}
  }
}

function sanitizeDirectoryName(value: string, fallback: string): string {
  const clean = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
  return clean || fallback
}

function sanitizeFileStem(value: string, fallback: string): string {
  const noExt = value.replace(/\.[^/.]+$/, '')
  const clean = noExt
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 140)
  return clean || fallback
}

function slugFromJobTitle(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'Role'
}

function buildDefaultBaseFileName(job: Job, settings: Record<string, unknown>): string {
  const prefix = typeof settings.exportNamePrefix === 'string'
    ? settings.exportNamePrefix
    : ''
  const safePrefix = sanitizeFileStem(prefix, 'Candidate')
  return sanitizeFileStem(`${safePrefix}_${slugFromJobTitle(job.title)}`, `${safePrefix}_Role`)
}

function nextAvailablePath(filePath: string): string {
  if (!fs.existsSync(filePath)) return filePath
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath)
  const stem = path.basename(filePath, ext)
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(dir, `${stem} (${i})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  return path.join(dir, `${stem}_${Date.now()}${ext}`)
}

function getDocxLayoutConfig(preset: ResumeLayoutPreset): DocxLayoutConfig {
  if (preset === 'ats_compact') {
    return {
      font: 'Times New Roman',
      bodySize: 20,
      heading1Size: 24,
      heading2Size: 22,
      heading3Size: 20,
      nameSize: 30,
      contactSize: 19,
      sectionHeadingSize: 22,
      lineSpacing: 240,
      paragraphAfter: 50,
      bulletAfter: 32,
      margins: { top: 0.55, right: 0.55, bottom: 0.55, left: 0.55 },
    }
  }

  if (preset === 'ats_detailed') {
    return {
      font: 'Times New Roman',
      bodySize: 22,
      heading1Size: 26,
      heading2Size: 24,
      heading3Size: 22,
      nameSize: 34,
      contactSize: 21,
      sectionHeadingSize: 24,
      lineSpacing: 270,
      paragraphAfter: 78,
      bulletAfter: 55,
      margins: { top: 0.85, right: 0.8, bottom: 0.85, left: 0.8 },
    }
  }

  return {
    font: 'Times New Roman',
    bodySize: 21,
    heading1Size: 24,
    heading2Size: 23,
    heading3Size: 21,
    nameSize: 32,
    contactSize: 21,
    sectionHeadingSize: 24,
    lineSpacing: 252,
    paragraphAfter: 62,
    bulletAfter: 42,
    margins: { top: 0.75, right: 0.7, bottom: 0.75, left: 0.7 },
  }
}

function buildDocxDocument(paragraphs: Paragraph[], layout: DocxLayoutConfig): Document {
  return new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(layout.margins.top),
            right: convertInchesToTwip(layout.margins.right),
            bottom: convertInchesToTwip(layout.margins.bottom),
            left: convertInchesToTwip(layout.margins.left),
          },
        },
      },
      children: paragraphs,
    }],
  })
}

function extractTopLevelBlocksFromHtml(html: string): string[] {
  const $ = cheerio.load(html)
  const blocks: string[] = []
  const root = $('body').children().length ? $('body').children() : $.root().children()
  root.each((_i, el) => {
    const tag = (el as cheerio.Element & { tagName?: string }).tagName?.toLowerCase()
    if (tag === 'ul' || tag === 'ol') {
      $(el).find('li').each((_liIdx, li) => {
        const text = $(li).text().replace(/\s+/g, ' ').trim()
        if (text) blocks.push(`- ${text}`)
      })
      return
    }
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    if (text) blocks.push(text)
  })

  if (blocks.length === 0) {
    const plain = $.text().replace(/\s+/g, ' ').trim()
    if (plain) blocks.push(plain)
  }

  return blocks
}

const COMMON_RESUME_HEADINGS = [
  'education',
  'experience',
  'professional experience',
  'research experience',
  'work experience',
  'skills',
  'technical skills',
  'publications',
  'awards',
  'leadership',
  'certifications',
  'projects',
  'summary',
]

function isLikelyNameLine(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return false
  if (t.length > 60) return false
  if (/[0-9@|]/.test(t)) return false
  if (/:/.test(t)) return false
  const words = t.split(' ').filter(Boolean)
  if (words.length < 2 || words.length > 5) return false
  return /^[a-zA-Z.' -]+$/.test(t)
}

function isLikelyContactLine(text: string): boolean {
  const t = text.toLowerCase()
  if (!t.trim()) return false
  return /@/.test(t) || /\b(cell|phone|mobile|linkedin)\b/.test(t) || /\d{3}[-.)\s]\d{3}[-.\s]\d{4}/.test(t) || /\|/.test(t)
}

function isLikelySectionHeading(text: string): boolean {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return false
  const normalized = trimmed.replace(/[^a-zA-Z ]/g, '').toLowerCase().trim()
  if (!normalized) return false
  if (COMMON_RESUME_HEADINGS.includes(normalized)) return true
  const words = normalized.split(' ').filter(Boolean)
  if (words.length <= 5 && trimmed === trimmed.toUpperCase()) return true
  return false
}

function buildExportFileName(baseName: string, type: ExportMaterialType, format: ExportFormat): string {
  const typeSuffix = type === 'resume' ? 'Resume' : 'CoverLetter'
  if (format === 'docx_minimal') return `${baseName}_${typeSuffix}_Minimal.docx`
  if (format === 'pdf_formatted') return `${baseName}_${typeSuffix}.pdf`
  return `${baseName}_${typeSuffix}.docx`
}

function runWithLayoutDefaults(layout: DocxLayoutConfig, text: string, overrides: Partial<{ bold: boolean; italics: boolean; underline: boolean; size: number }> = {}): TextRun {
  return new TextRun({
    text,
    font: layout.font,
    size: overrides.size ?? layout.bodySize,
    bold: overrides.bold,
    italics: overrides.italics,
    underline: overrides.underline ? {} : undefined,
  })
}

function buildParagraphSpacing(layout: DocxLayoutConfig, after?: number): { line: number; after: number } {
  return { line: layout.lineSpacing, after: after ?? layout.paragraphAfter }
}

function parseHtmlToMinimalDocxParagraphs(html: string, layout: DocxLayoutConfig, materialType: ExportMaterialType): Paragraph[] {
  const blocks = extractTopLevelBlocksFromHtml(html)
  const paragraphs = blocks.map((text, idx) => {
    const isResume = materialType === 'resume'

    if (isResume && idx === 0 && isLikelyNameLine(text)) {
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [runWithLayoutDefaults(layout, text, { bold: true, size: layout.nameSize })],
        spacing: buildParagraphSpacing(layout, 20),
      })
    }

    if (isResume && idx === 1 && isLikelyContactLine(text)) {
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [runWithLayoutDefaults(layout, text, { size: layout.contactSize })],
        spacing: buildParagraphSpacing(layout, layout.paragraphAfter + 30),
      })
    }

    if (isResume && isLikelySectionHeading(text)) {
      return new Paragraph({
        children: [runWithLayoutDefaults(layout, text.toUpperCase(), { bold: true, size: layout.sectionHeadingSize })],
        spacing: buildParagraphSpacing(layout, 45),
      })
    }

    return new Paragraph({
      children: [runWithLayoutDefaults(layout, text)],
      spacing: buildParagraphSpacing(layout),
    })
  })
  return paragraphs.length ? paragraphs : [new Paragraph({ children: [runWithLayoutDefaults(layout, ' ')], spacing: buildParagraphSpacing(layout) })]
}

function parseHtmlToDocxParagraphs(html: string, layout: DocxLayoutConfig, materialType: ExportMaterialType): Paragraph[] {
  const $ = cheerio.load(html)
  const paragraphs: Paragraph[] = []
  const isResume = materialType === 'resume'

  const root = $('body').children().length ? $('body').children() : $.root().children()

  root.each((idx, el) => {
    const tag = (el as cheerio.Element & { tagName?: string }).tagName?.toLowerCase()
    const text = $(el).text().trim()
    if (!text) return

    if (isResume && idx === 0 && isLikelyNameLine(text)) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [runWithLayoutDefaults(layout, text, { bold: true, size: layout.nameSize })],
        spacing: buildParagraphSpacing(layout, 20),
      }))
      return
    }

    if (isResume && idx === 1 && isLikelyContactLine(text)) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [runWithLayoutDefaults(layout, text, { size: layout.contactSize })],
        spacing: buildParagraphSpacing(layout, layout.paragraphAfter + 30),
      }))
      return
    }

    const headingFromTag = tag === 'h1' || tag === 'h2' || tag === 'h3'
    const headingFromText = isResume && isLikelySectionHeading(text)
    if (headingFromTag || headingFromText) {
      const size = isResume
        ? layout.sectionHeadingSize
        : (tag === 'h1' ? layout.heading1Size : tag === 'h2' ? layout.heading2Size : layout.heading3Size)
      paragraphs.push(new Paragraph({
        children: [runWithLayoutDefaults(layout, isResume ? text.toUpperCase() : text, { bold: true, size })],
        spacing: buildParagraphSpacing(layout, 45),
      }))
      return
    }

    if (tag === 'ul' || tag === 'ol') {
      $(el).find('li').each((_liIdx, li) => {
        paragraphs.push(new Paragraph({
          bullet: { level: 0 },
          children: parseInlineElements($, li, layout),
          spacing: buildParagraphSpacing(layout, layout.bulletAfter),
        }))
      })
      return
    }

    paragraphs.push(new Paragraph({
      children: parseInlineElements($, el, layout),
      spacing: buildParagraphSpacing(layout),
    }))
  })

  if (paragraphs.length) return paragraphs

  const plain = extractTopLevelBlocksFromHtml(html).join('\n').trim()
  return [new Paragraph({
    children: [runWithLayoutDefaults(layout, plain || ' ')],
    spacing: buildParagraphSpacing(layout),
  })]
}

function parseInlineElements($: cheerio.CheerioAPI, el: cheerio.AnyNode, layout: DocxLayoutConfig): TextRun[] {
  const runs: TextRun[] = []
  $(el).contents().each((_idx, node) => {
    if (node.type === 'text') {
      const text = (node as cheerio.AnyNode & { data?: string }).data || ''
      const normalized = text.replace(/\s+/g, ' ')
      if (normalized.trim()) runs.push(runWithLayoutDefaults(layout, normalized))
      return
    }
    if (node.type !== 'tag') return
    const tag = (node as cheerio.AnyNode & { tagName?: string }).tagName?.toLowerCase()
    const text = $(node).text().replace(/\s+/g, ' ')
    if (!text.trim()) return
    if (tag === 'strong' || tag === 'b') {
      runs.push(runWithLayoutDefaults(layout, text, { bold: true }))
    } else if (tag === 'em' || tag === 'i') {
      runs.push(runWithLayoutDefaults(layout, text, { italics: true }))
    } else if (tag === 'u') {
      runs.push(runWithLayoutDefaults(layout, text, { underline: true }))
    } else {
      runs.push(runWithLayoutDefaults(layout, text))
    }
  })
  return runs.length ? runs : [runWithLayoutDefaults(layout, $(el).text().replace(/\s+/g, ' ').trim())]
}

function normalizeResumeHtmlForPdf(html: string): string {
  const $ = cheerio.load(html)
  const root = $('body').children().length ? $('body').children() : $.root().children()

  root.each((idx, el) => {
    const node = $(el)
    const text = node.text().replace(/\s+/g, ' ').trim()
    if (!text) return

    if (idx === 0 && isLikelyNameLine(text)) {
      node.attr('class', `${node.attr('class') || ''} resume-name-line`.trim())
      return
    }

    if (idx === 1 && isLikelyContactLine(text)) {
      node.attr('class', `${node.attr('class') || ''} resume-contact-line`.trim())
      return
    }

    const tag = (el as cheerio.Element & { tagName?: string }).tagName?.toLowerCase()
    if ((tag === 'p' || tag === 'div' || tag === 'span') && isLikelySectionHeading(text)) {
      node.replaceWith(`<h2>${text.toUpperCase()}</h2>`)
    }
  })

  const bodyHtml = $('body').length ? $('body').html() : $.root().html()
  return bodyHtml || html
}

function buildPdfHtmlDocument(html: string, layout: DocxLayoutConfig, materialType: ExportMaterialType): string {
  const normalizedHtml = materialType === 'resume' ? normalizeResumeHtmlForPdf(html) : html
  const resumeCss = materialType === 'resume'
    ? `
      body.resume-doc > .resume-name-line {
        text-align: center;
        font-size: ${layout.nameSize / 2}pt;
        font-weight: 700;
        margin: 0 0 0.02in;
      }
      body.resume-doc > .resume-contact-line {
        text-align: center;
        font-size: ${layout.contactSize / 2}pt;
        margin: 0 0 0.14in;
      }
      body.resume-doc h2 {
        font-size: ${layout.sectionHeadingSize / 2}pt;
        font-weight: 700;
        margin: 0.08in 0 0.03in;
      }
    `
    : ''

  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      @page { size: A4; margin: ${layout.margins.top}in ${layout.margins.right}in ${layout.margins.bottom}in ${layout.margins.left}in; }
      html, body { margin: 0; padding: 0; }
      body {
        font-family: ${layout.font}, Arial, sans-serif;
        font-size: ${layout.bodySize / 2}pt;
        line-height: ${Math.max(1.2, layout.lineSpacing / 220)};
        color: #111;
      }
      h1 { font-size: ${layout.heading1Size / 2}pt; margin: 0 0 0.3rem; }
      h2 { font-size: ${layout.heading2Size / 2}pt; margin: 0.5rem 0 0.3rem; }
      h3 { font-size: ${layout.heading3Size / 2}pt; margin: 0.4rem 0 0.25rem; }
      p { margin: 0 0 0.35rem; }
      ul, ol { margin: 0 0 0.35rem 1.15rem; padding: 0; }
      li { margin: 0 0 0.18rem; }
      ${resumeCss}
    </style>
  </head>
  <body class="${materialType === 'resume' ? 'resume-doc' : 'material-doc'}">
    ${normalizedHtml}
  </body>
</html>`
}

async function renderPdfBufferFromHtml(html: string, layout: DocxLayoutConfig, materialType: ExportMaterialType): Promise<Buffer> {
  const pdfWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 1810,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  try {
    const wrapped = buildPdfHtmlDocument(html, layout, materialType)
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(wrapped)}`)
    await pdfWindow.webContents.executeJavaScript(`
      (async () => {
        if (document?.fonts?.ready) await document.fonts.ready
        return true
      })()
    `).catch(() => true)

    return await pdfWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
    })
  } finally {
    if (!pdfWindow.isDestroyed()) pdfWindow.destroy()
  }
}

async function exportJobMaterials(payload: JobExportPayload): Promise<{
  success: boolean
  error?: string
  conflict?: boolean
  existingFiles?: string[]
  files?: string[]
  dirPath?: string
  strategyUsed?: OverwriteStrategy | 'none'
}> {
  const db = getDb()
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(payload.jobId) as Job | undefined
  if (!job) return { success: false, error: 'Job not found' }
  if (!payload.html?.trim()) return { success: false, error: 'Nothing to export yet.' }

  const settings = loadLocalSettings()
  const outputFolder = typeof settings.outputFolder === 'string' && settings.outputFolder.trim()
    ? settings.outputFolder
    : app.getPath('documents')

  const dirName = sanitizeDirectoryName(`${job.company} — ${job.title}`, 'Job Export')
  const dirPath = path.join(outputFolder, dirName)
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })

  const requested = Array.from(new Set((payload.formats || []).filter(Boolean))) as ExportFormat[]
  if (requested.length === 0) return { success: false, error: 'Select at least one export type.' }

  const overwriteStrategy: OverwriteStrategy = payload.overwriteStrategy || 'prompt'
  const fallbackBase = buildDefaultBaseFileName(job, settings)
  const baseFileName = sanitizeFileStem(payload.baseFileName || '', fallbackBase)
  const presetFromSettings = settings.resumeLayoutPreset as ResumeLayoutPreset | undefined
  const effectivePreset = payload.resumeLayoutPreset || presetFromSettings || 'ats_standard'
  const layout = getDocxLayoutConfig(effectivePreset)

  const targets: Array<{ format: ExportFormat; filePath: string }> = []
  const conflicts: string[] = []

  for (const format of requested) {
    const fileName = buildExportFileName(baseFileName, payload.type, format)
    const requestedPath = path.join(dirPath, fileName)

    if (fs.existsSync(requestedPath)) {
      if (overwriteStrategy === 'prompt') {
        conflicts.push(requestedPath)
        targets.push({ format, filePath: requestedPath })
        continue
      }
      if (overwriteStrategy === 'new') {
        targets.push({ format, filePath: nextAvailablePath(requestedPath) })
        continue
      }
      targets.push({ format, filePath: requestedPath })
      continue
    }

    targets.push({ format, filePath: requestedPath })
  }

  if (conflicts.length > 0 && overwriteStrategy === 'prompt') {
    return {
      success: false,
      conflict: true,
      existingFiles: conflicts,
      dirPath,
    }
  }

  const writtenFiles: string[] = []
  for (const target of targets) {
    if (target.format === 'docx_formatted') {
      const doc = buildDocxDocument(parseHtmlToDocxParagraphs(payload.html, layout, payload.type), layout)
      const buffer = await Packer.toBuffer(doc)
      fs.writeFileSync(target.filePath, buffer)
      writtenFiles.push(target.filePath)
      continue
    }

    if (target.format === 'docx_minimal') {
      const doc = buildDocxDocument(parseHtmlToMinimalDocxParagraphs(payload.html, layout, payload.type), layout)
      const buffer = await Packer.toBuffer(doc)
      fs.writeFileSync(target.filePath, buffer)
      writtenFiles.push(target.filePath)
      continue
    }

    const pdf = await renderPdfBufferFromHtml(payload.html, layout, payload.type)
    fs.writeFileSync(target.filePath, pdf)
    writtenFiles.push(target.filePath)
  }

  const docxPath = writtenFiles.find(p => p.toLowerCase().endsWith('.docx')) || null
  const pdfPath = writtenFiles.find(p => p.toLowerCase().endsWith('.pdf')) || null
  const exists = db.prepare('SELECT id FROM application_materials WHERE job_id=? AND type=?').get(payload.jobId, payload.type) as { id?: number } | undefined
  if (exists?.id) {
    db.prepare(`
      UPDATE application_materials
      SET exported_docx_path=COALESCE(?, exported_docx_path),
          exported_pdf_path=COALESCE(?, exported_pdf_path),
          updated_at=datetime('now')
      WHERE id=?
    `).run(docxPath, pdfPath, exists.id)
  }

  return {
    success: true,
    files: writtenFiles,
    dirPath,
    strategyUsed: conflicts.length ? overwriteStrategy : 'none',
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
                  '._1ab93946',   // LinkedIn 2025+ obfuscated class
                  '[class*="job-description"]',
                  '.jobs-description__content',
                  '.description__text--rich',
                ]
                for (const sel of descSelectors) {
                  const els = $(sel)
                  if (!els.length) continue
                  // Iterate matches — find the one that contains the job description
                  els.each((_i, el) => {
                    if (description) return
                    let txt = $(el).text().trim()
                    if (txt.length < 100) return
                    // Strip 'About the job' prefix if present (new merged structure)
                    if (/^About the [Jj]ob/i.test(txt)) txt = txt.slice(13).trim()
                    // Apply cutoffs to remove trailing sections
                    const cutoffs = ['Meet the team', 'People also viewed', 'Similar jobs', 'About the company', 'Report job', 'Show less']
                    for (const cut of cutoffs) {
                      const ci = txt.indexOf(cut)
                      if (ci > 100) { txt = txt.slice(0, ci).trim(); break }
                    }
                    if (txt.length > 100) {
                      description = txt
                      console.log(`[enrich] job ${jobId}: SSR "${sel}" → ${txt.length} chars`)
                    }
                  })
                  if (description) break
                }
              }

              // Strategy 2b: Text-content search (robust against obfuscated classes)
              if (!description) {
                $('div,section,article').each((_i, el) => {
                  if (description) return
                  let txt = $(el).text().trim()
                  if (!(/^About the [Jj]ob/i.test(txt)) || txt.length < 100) return
                  txt = txt.slice(13).trim()
                  const cutoffs = ['Meet the team', 'People also viewed', 'Similar jobs', 'About the company', 'Report job', 'Show less']
                  for (const cut of cutoffs) {
                    const ci = txt.indexOf(cut)
                    if (ci > 100) { txt = txt.slice(0, ci).trim(); break }
                  }
                  if (txt.length > 100) {
                    description = txt
                    console.log(`[enrich] job ${jobId}: SSR text-search → ${txt.length} chars`)
                  }
                })
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
                const normalizedDesc = normalizeDescriptionText(description)
                if (isLikelyTruncatedDescription(normalizedDesc) || isLikelyHeroSummary(normalizedDesc)) {
                  console.log(`[enrich] job ${jobId}: server description looks truncated/hero-summary; falling back to DOM expansion`)
                } else {
                  const cleanedDesc = await cleanDescriptionWithLlm(normalizedDesc)
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
          // Initial wait — React shell + SSR hydration + lazy section rendering
          await new Promise((r) => setTimeout(r, 5000))
          await expandAboutSectionAndWait(view)

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
              companyDesc: string | null; expandClicked: string | null
            }
            const domResult = await view.webContents.executeJavaScript(`
              (async function() {
                // ── Step 1: Click ALL expand/show-more buttons ────────────────
                // LinkedIn 2025: the "...more" button is a <div>, not a <button>.
                // We click ALL matching elements so both "About the job" and
                // "About the company" sections are fully expanded before extraction.
                var expandLog = [];

                // Text-content match — includes div[class] for LinkedIn 2025 div-buttons
                var allEls = document.querySelectorAll('button, a, [role="button"], span[tabindex], div[class], span[class]');
                for (var i = 0; i < allEls.length; i++) {
                  var txt = (allEls[i].innerText || '').trim();
                  var lower = txt.toLowerCase();
                  if (lower === 'show more' || lower === 'see more' || lower === 'show more description' ||
                      txt === '…more' || txt === '...more' || txt === '…' ||
                      /^[…\\.]{1,3}more$/i.test(txt)) {
                    allEls[i].click();
                    expandLog.push('text:' + JSON.stringify(txt));
                  }
                }

                // aria-expanded=false with relevant label
                var ariaEls = document.querySelectorAll('[aria-expanded="false"]');
                for (var j = 0; j < ariaEls.length; j++) {
                  var label = (ariaEls[j].getAttribute('aria-label') || '').toLowerCase();
                  if (/show|more|expand|description/i.test(label)) {
                    ariaEls[j].click();
                    expandLog.push('aria:' + label);
                  }
                }

                // Class-based selectors (LinkedIn 2025 hashed classes first, then legacy)
                var expandSelectors = [
                  'div._1aedd3df._1b208336._90b46d8b._7028146f',  // LinkedIn 2025 "...more" div
                  '.show-more-less-html__button--more',
                  '.inline-show-more-text__button',
                  'button[class*="show-more"]',
                  '[data-tracking-control-name*="show-more"]',
                  '[data-tracking-control-name*="see_more"]',
                  '.jobs-description__footer-action',
                ];
                for (var s = 0; s < expandSelectors.length; s++) {
                  var btns = document.querySelectorAll(expandSelectors[s]);
                  for (var bi = 0; bi < btns.length; bi++) {
                    btns[bi].click();
                    expandLog.push('class:' + expandSelectors[s]);
                  }
                }

                var expandClicked = expandLog.length > 0 ? expandLog.join('; ') : null;
                console.log('[enrich-dom] expand clicks:', expandClicked || 'none found');

                // Scroll down to trigger IntersectionObserver-gated sections,
                // then back up so all content is in the rendered tree
                window.scrollTo(0, 600);
                await new Promise(r => setTimeout(r, 400));
                window.scrollTo(0, 1400);
                await new Promise(r => setTimeout(r, 400));
                window.scrollTo(0, 0);

                // Wait for expand animations and any deferred rendering
                await new Promise(r => setTimeout(r, expandClicked ? 1800 : 800));

                // ── Step 2: Targeted extraction of 'About the job' section ────
                var description = null;
                var descSource = null;

                // Strategy A: Find 'About the job' section
                // Handles both old structure (separate heading element) and new merged structure
                // where heading and full description text are in the same DOM element.
                var allEls2 = document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p');
                var cutoffsA = ['Meet the team', 'People also viewed', 'Similar jobs', 'Show more jobs', 'LinkedIn members', 'About the company', 'Report job', 'Show less'];
                for (var h = 0; h < allEls2.length; h++) {
                  if (description) break;
                  var elText = (allEls2[h].innerText || '').trim();

                  // Case 1: Exact heading only (old LinkedIn DOM — heading is its own element)
                  if (elText === 'About the job' || elText === 'About the Job') {
                    var cur = allEls2[h].parentElement;
                    while (cur && cur !== document.body) {
                      var full = (cur.innerText || '').trim();
                      if (full.length > 200) {
                        var idx = full.indexOf('About the job'); if (idx === -1) idx = full.indexOf('About the Job');
                        var raw = idx !== -1 ? full.slice(idx + 13).trim() : full;
                        for (var c = 0; c < cutoffsA.length; c++) { var ci = raw.indexOf(cutoffsA[c]); if (ci > 100) { raw = raw.slice(0, ci).trim(); break; } }
                        if (raw.length > 100) { description = raw; descSource = 'heading:exact'; break; }
                      }
                      cur = cur.parentElement;
                    }
                  }

                  // Case 2: Heading merged with content (new LinkedIn DOM — same element has both)
                  if (!description && (elText.startsWith('About the job') || elText.startsWith('About the Job')) && elText.length > 200) {
                    var raw2 = elText.slice(13).trim();
                    for (var c2 = 0; c2 < cutoffsA.length; c2++) { var ci2 = raw2.indexOf(cutoffsA[c2]); if (ci2 > 100) { raw2 = raw2.slice(0, ci2).trim(); break; } }
                    if (raw2.length > 100) { description = raw2; descSource = 'heading:merged'; break; }
                  }
                }

                // Strategy B: CSS selectors targeting the description markup
                if (!description) {
                  var descSelectors = [
                    'p.ff44be0a.c2dd7318.bab11c20._65531f27',  // LinkedIn 2025 job description paragraph
                    '.show-more-less-html__markup',
                    '#job-details',
                    '._1ab93946',
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
                      // Strip merged heading prefix if present
                      if (txt.startsWith('About the job') || txt.startsWith('About the Job')) txt = txt.slice(13).trim();
                      // Apply cutoffs
                      for (var dc = 0; dc < cutoffsA.length; dc++) { var dci = txt.indexOf(cutoffsA[dc]); if (dci > 100) { txt = txt.slice(0, dci).trim(); break; } }
                      // Must be substantial and not just a header/label
                      if (txt.length > 150 && txt.split('\\n').length > 3) {
                        description = txt;
                        descSource = 'selector:' + descSelectors[ds];
                      }
                    }
                  }
                }

                // Strategy C: Raw body text search — works regardless of DOM structure
                // If "About the job" appears anywhere in the rendered page text, extract it.
                if (!description) {
                  var bodyText = (document.body.innerText || '').replace(/[ \\t]+/g, ' ');
                  var abIdx = bodyText.indexOf('About the job');
                  if (abIdx === -1) abIdx = bodyText.indexOf('About the Job');
                  if (abIdx !== -1) {
                    var raw3 = bodyText.slice(abIdx + 13).trim();
                    for (var c3 = 0; c3 < cutoffsA.length; c3++) {
                      var ci3 = raw3.indexOf(cutoffsA[c3]);
                      if (ci3 > 100) { raw3 = raw3.slice(0, ci3).trim(); break; }
                    }
                    if (raw3.length > 100) { description = raw3; descSource = 'body:text-search'; }
                  }
                  console.log('[enrich-dom] Strategy C: hasAboutJob=' + (abIdx !== -1) + ', bodyLen=' + bodyText.length);
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
                var company = first(['a._90b46d8b._7028146f.d7de54f9.d7342652', 'div.f282d9dd._5afe57c9._24162c52.e5367532', '[class*="company-name"]', 'a[class*="company"]', '[class*="employer"]', '.topcard__org-name-link']);
                var location = first(['[class*="location"]', '.job-location', '.topcard__flavor--bullet']);
                var salary = first(['[class*="salary"]', '[class*="compensation"]', '.job-details-jobs-unified-top-card__salary-info']);
                var jobType = first(['[class*="employment-type"]', '[class*="job-type"]']);
                var workplaceType = first(['[class*="workplace"]', '[class*="remote"]', '[class*="work-place"]']);
                var applicantCount = first(['[class*="num-applicant"]', '[class*="applicant-count"]', '.num-applicants__caption']);

                // ── Step 4: Company description from 'About the company' section ─
                var companyDesc = null;
                var companyDescSelectors = [
                  'p.ff44be0a.c2dd7318.d6859b00.dfed372d',        // LinkedIn 2025 company desc paragraph
                  'div._27fa1ff5._6247f233.f282d9dd.b41dfbd9 p',  // LinkedIn 2025 expanded company container
                  'div._0d0a0480 p',                               // LinkedIn 2025 company section → any paragraph
                ];
                for (var cd = 0; cd < companyDescSelectors.length && !companyDesc; cd++) {
                  var cdEl = document.querySelector(companyDescSelectors[cd]);
                  if (cdEl) {
                    var cdTxt = (cdEl.innerText || '').trim();
                    if (cdTxt.length > 50) { companyDesc = cdTxt.slice(0, 2000); }
                  }
                }

                return { title, company, location, salary, jobType, workplaceType, applicantCount, description, descSource, companyDesc, expandClicked };
              })()
            `).catch(() => null) as DomResult | null

            console.log(`[enrich] job ${jobId}: DOM result — source: ${domResult?.descSource ?? 'none'}, desc length: ${domResult?.description?.length ?? 0}`)

            let domDescription = domResult?.description ? normalizeDescriptionText(domResult.description) : null
            if (domDescription && (isLikelyTruncatedDescription(domDescription) || isLikelyHeroSummary(domDescription))) {
              console.log(`[enrich] job ${jobId}: DOM description looks truncated/hero-summary; running recovery passes`)
              domDescription = null
            }

            if (domDescription) {
              console.log(`[enrich] job ${jobId}: raw description (first 300): ${domDescription.slice(0, 300)}`)
              const cleanedDesc = await cleanDescriptionWithLlm(domDescription)
              console.log(`[enrich] job ${jobId}: cleaned description (first 300): ${cleanedDesc.slice(0, 300)}`)
              if (domResult?.companyDesc) console.log(`[enrich] job ${jobId}: company desc found (${domResult.companyDesc.length} chars)`)

              db.prepare(`
                UPDATE jobs SET description=?, salary=?, seniority_level=?, job_type=?,
                num_applicants=?, easy_apply=?,
                company_research=COALESCE(NULLIF(company_research,''), ?),
                status='no_response', updated_at=datetime('now')
                WHERE id=?
              `).run(
                cleanedDesc,
                domResult?.salary || null,
                null, // seniority not extracted in this path
                domResult?.jobType || null,
                null, // applicantCount is a string here, skip parsing
                0,    // easyApply not extracted in this path
                domResult?.companyDesc || null,
                jobId
              )
              results[jobId] = { success: true }
              enriched = true
            } else {
              let recoveredDescription: string | null = null
              let recoverySource = ''

              // Recovery pass 1: replay selectors learned from manual captures/confirmations.
              const host = hostnameFromUrl(job.url)
              if (host) {
                try {
                  const rows = db.prepare(`
                    SELECT selectors_json, chain_json
                    FROM enrichment_patterns
                    WHERE field_type='description' AND (url_pattern=? OR (url_pattern IS NULL AND url LIKE ?))
                    ORDER BY created_at DESC
                    LIMIT 25
                  `).all(host, `%${host}%`) as Array<{ selectors_json: string | null; chain_json: string | null }>

                  const selectors = selectorsFromPatternRows(rows)
                  if (selectors.length > 0) {
                    const clicks = await clickLikelyExpandButtons(view)
                    console.log(`[enrich] job ${jobId}: pattern replay attempting ${selectors.length} selector(s); pre-clicked expand controls: ${clicks}`)
                    const replay = await extractWithSavedSelectors(view, selectors)
                    if (replay.description) {
                      recoveredDescription = replay.description
                      recoverySource = replay.selector ? `pattern:${replay.selector}` : 'pattern:selector-replay'
                    }
                  }
                } catch (patternErr) {
                  console.log(`[enrich] job ${jobId}: pattern replay error:`, patternErr)
                }
              }

              // Recovery pass 2: explicit "About this/the job" section extraction.
              if (!recoveredDescription) {
                const clicks = await clickLikelyExpandButtons(view)
                console.log(`[enrich] job ${jobId}: about-section recovery; clicked expand controls: ${clicks}`)
                const aboutDesc = await extractFromAboutSection(view)
                if (aboutDesc) {
                  recoveredDescription = aboutDesc
                  recoverySource = 'about-section'
                }
              }

              if (recoveredDescription) {
                const normalizedDesc = normalizeDescriptionText(recoveredDescription)
                const cleanedDesc = await cleanDescriptionWithLlm(normalizedDesc)
                console.log(`[enrich] job ${jobId}: recovered description via ${recoverySource} (${cleanedDesc.length} chars)`)
                db.prepare(`
                  UPDATE jobs SET description=?, salary=?, seniority_level=?, job_type=?,
                  num_applicants=?, easy_apply=?,
                  company_research=COALESCE(NULLIF(company_research,''), ?),
                  status='no_response', updated_at=datetime('now')
                  WHERE id=?
                `).run(
                  cleanedDesc,
                  domResult?.salary || null,
                  null,
                  domResult?.jobType || null,
                  null,
                  0,
                  domResult?.companyDesc || null,
                  jobId
                )
                results[jobId] = { success: true }
                enriched = true
              } else {
                db.prepare(`UPDATE jobs SET status='enrichment_failed', updated_at=datetime('now') WHERE id=?`).run(jobId)
                results[jobId] = { success: false, error: 'Could not find the expanded "About this job" section. Open Manual Enrich, highlight the full description, and click Save Description.' }
              }
            }
          }
        } catch (err) {
          db.prepare(`UPDATE jobs SET status='enrichment_failed', updated_at=datetime('now') WHERE id=?`).run(jobId)
          results[jobId] = { success: false, error: String(err) }
        }
      }

      // Delay between jobs (short for server-side success, longer for WebContentsView)
      if (jobId !== jobIds[jobIds.length - 1]) {
        const minDelay = enriched && !authFailed ? 3000 : 7000
        const maxDelay = enriched && !authFailed ? 9000 : 15000
        const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay
        await new Promise((r) => setTimeout(r, delay))
      }
    }

    return results
  })

  ipcMain.handle(IPC.LINKEDIN_PROBE_URLS, async (_evt, inputUrls: string[]) => {
    const view = getLinkedinView()
    const db = getDb()
    const rawUrls = Array.isArray(inputUrls) ? inputUrls : []
    const urls = Array.from(new Set(rawUrls.map(u => String(u || '').trim()).filter(Boolean))).slice(0, 20)

    type ProbeResult = {
      url: string
      success: boolean
      method?: string
      descriptionLength?: number
      descriptionPreview?: string
      authRequired?: boolean
      error?: string
      fetchFinalUrl?: string
      domFinalUrl?: string
      expandClicks?: number
      patternSelectorsTried?: number
      steps: string[]
    }

    if (urls.length === 0) return [] as ProbeResult[]
    if (!view) {
      return urls.map((url) => ({
        url,
        success: false,
        error: 'Embedded browser not available',
        steps: ['view:missing'],
      })) satisfies ProbeResult[]
    }

    const sess = session.fromPartition('persist:linkedin')
    const cookies = await sess.cookies.get({ domain: '.linkedin.com' }).catch(() => [])
    const liAt = cookies.find(c => c.name === 'li_at')
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

    const out: ProbeResult[] = []

    for (const url of urls) {
      const result: ProbeResult = { url, success: false, steps: [] }
      out.push(result)

      const host = hostnameFromUrl(url)
      if (!host || !host.includes('linkedin.com')) {
        result.error = 'Not a valid LinkedIn URL'
        result.steps.push('url:invalid')
        continue
      }

      let extracted: string | null = null

      // Server-side pass using persisted LinkedIn cookie session
      if (liAt && cookieHeader) {
        try {
          result.steps.push('server:start')
          const resp = await fetch(url, {
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

          result.fetchFinalUrl = resp.url
          if (/\/(login|authwall|checkpoint\/challenge)/.test(resp.url)) {
            result.authRequired = true
            result.steps.push('server:authwall')
          } else {
            const html = await resp.text()
            const parsed = extractDescriptionFromServerHtml(html)
            if (parsed.description) {
              const normalized = normalizeDescriptionText(parsed.description)
              if (isLikelyTruncatedDescription(normalized) || isLikelyHeroSummary(normalized)) {
                result.steps.push('server:description-truncated-or-hero')
              } else {
                extracted = normalized
                result.method = parsed.source || 'server'
                result.steps.push('server:description-found')
              }
            } else {
              result.steps.push('server:no-description')
            }
          }
        } catch (err) {
          result.steps.push(`server:error:${String(err).slice(0, 160)}`)
        }
      } else {
        result.steps.push('server:no-li_at-cookie')
      }

      if (!extracted) {
        try {
          result.steps.push('dom:start')
          await view.webContents.loadURL(url)
          await new Promise((r) => setTimeout(r, 4500))
          result.domFinalUrl = view.webContents.getURL()

          if (/\/(login|authwall|checkpoint\/challenge)/.test(result.domFinalUrl)) {
            result.authRequired = true
            result.steps.push('dom:authwall')
          } else {
            const aboutExpandClicks = await expandAboutSectionAndWait(view)
            result.steps.push(`dom:about-expand-clicks:${aboutExpandClicks}`)
            const expandClicks = await clickLikelyExpandButtons(view)
            result.expandClicks = expandClicks
            result.steps.push(`dom:expand-clicks:${expandClicks}`)

            const rows = db.prepare(`
              SELECT selectors_json, chain_json
              FROM enrichment_patterns
              WHERE field_type='description' AND (url_pattern=? OR (url_pattern IS NULL AND url LIKE ?))
              ORDER BY created_at DESC
              LIMIT 25
            `).all(host, `%${host}%`) as Array<{ selectors_json: string | null; chain_json: string | null }>

            const selectors = selectorsFromPatternRows(rows)
            result.patternSelectorsTried = selectors.length
            if (selectors.length > 0) {
              const replay = await extractWithSavedSelectors(view, selectors)
              if (replay.description) {
                extracted = normalizeDescriptionText(replay.description)
                result.method = replay.selector ? `dom:pattern:${replay.selector}` : 'dom:pattern-replay'
                result.steps.push('dom:pattern-success')
              } else {
                result.steps.push('dom:pattern-miss')
              }
            } else {
              result.steps.push('dom:no-patterns')
            }

            if (!extracted) {
              const about = await extractFromAboutSection(view)
              if (about) {
                extracted = normalizeDescriptionText(about)
                result.method = 'dom:about-section'
                result.steps.push('dom:about-success')
              } else {
                result.steps.push('dom:about-miss')
              }
            }

            if (!extracted) {
              const body = await extractFromBodyAboutText(view)
              if (body) {
                extracted = normalizeDescriptionText(body)
                result.method = 'dom:body-about-search'
                result.steps.push('dom:body-success')
              } else {
                result.steps.push('dom:body-miss')
              }
            }
          }
        } catch (err) {
          result.steps.push(`dom:error:${String(err).slice(0, 160)}`)
        }
      }

      if (extracted && isLikelyHeroSummary(extracted)) {
        result.steps.push('filtered:hero-summary')
        extracted = null
      }

      if (extracted) {
        result.success = true
        result.descriptionLength = extracted.length
        result.descriptionPreview = extracted.slice(0, 600)
        if (!result.method) result.method = 'unknown'
      } else if (result.authRequired) {
        result.error = 'Authentication required — open LinkedIn Browser and sign in, then rerun probe.'
      } else {
        result.error = 'Description not found via server/DOM strategies.'
      }

      await new Promise((r) => setTimeout(r, 1200))
    }

    return out
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

    const targetUrl = buildCompanyResearchTarget(companyName, url)
    if (!targetUrl) return { success: false, error: 'Could not build a valid company research URL.' }
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

  ipcMain.handle(IPC.JOB_EXPORT_MATERIALS, async (_evt, payload: JobExportPayload) => {
    return exportJobMaterials(payload)
  })

  // Legacy bridge for old renderer calls.
  ipcMain.handle(IPC.JOB_EXPORT_DOCX, async (_evt, jobId: number, type: ExportMaterialType, htmlContent: string, lastName: string) => {
    const result = await exportJobMaterials({
      jobId,
      type,
      html: htmlContent,
      baseFileName: lastName || '',
      formats: ['docx_formatted'],
      overwriteStrategy: 'overwrite',
    })
    if (!result.success) return result
    return {
      success: true,
      filePath: result.files?.[0],
      files: result.files || [],
      dirPath: result.dirPath,
    }
  })

  ipcMain.handle(IPC.JOB_OPEN_FILE, async (_evt, filePath: string) => {
    const { shell } = await import('electron')
    await shell.openPath(filePath)
    return true
  })

  // ── Enrichment Pattern Repository ──────────────────────────────────────────

  ipcMain.handle(IPC.PATTERN_SAVE, (_evt, pattern: Record<string, unknown>) => {
    const db = getDb()
    db.prepare(`
      INSERT INTO enrichment_patterns
        (job_id, url, url_pattern, field_type, selected_text, chain_json, selectors_json, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pattern.jobId ?? null,
      pattern.url ?? null,
      pattern.urlPattern ?? null,
      pattern.fieldType ?? 'description',
      pattern.selectedText ?? null,
      pattern.chainJson ?? null,
      pattern.selectorsJson ?? null,
      pattern.source ?? 'manual_enrich',
    )
    return { ok: true }
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
