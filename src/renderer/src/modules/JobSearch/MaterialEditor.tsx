import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Send, Loader2, Download, Copy, RefreshCw, Globe, X, AlertTriangle } from 'lucide-react'
import type {
  Job,
  ResumeBase,
  ChatMessage,
  ResumeCompareAnnotatedRow,
  ResumeCompareLineKind,
  ResumeCompareRowSideStatus,
  ResumeCompareWindowPayload,
  ResumeCompareWordToken,
} from '@shared/types'
import { useToast } from '../../shared/hooks/useToast'
import ResumeCompareContent from './ResumeCompareContent'

const RESUME_SYSTEM = `You are an expert resume writer specializing in biomedical and life sciences roles.
Generate a tailored, ATS-friendly resume. Requirements:
- No tables, text boxes, or graphics — use standard paragraph styles only
- Sections: Summary, Experience, Skills, Education, Publications
- Keywords from the job description woven in naturally
- Strong action verbs, quantified impact where possible
- Preserve each experience entry boundary from the base resume (company/lab + role + dates + its bullets).
- Do not transfer or blend achievements, technologies, or impact claims across different roles.
- Only strengthen wording within the same role entry; if a claim is not supported in that role's base bullets, do not add it.
- IMPORTANT: Do NOT modify the Publications section. Copy it exactly from the base resume.`

const COVER_LETTER_SYSTEM = `You are an expert cover letter writer for biomedical/life sciences professionals.
Write a concise, compelling cover letter (3-4 paragraphs). Requirements:
- Avoid generic openers ("I am writing to apply for...")
- Reference 1-2 specific things about the company from the research provided
- Specific to this role and company
- Professional but personable tone
- No fluff — every sentence should add value`

const RECRUITER_SYSTEM = `You are writing a direct LinkedIn message or email to a recruiter or hiring manager.
Requirements:
- 150-250 words
- Professional and direct
- Open with: "Hi [Name],"
- Brief intro, specific interest in this role, one key relevant qualification
- Clear call to action
- Use only facts present in the provided candidate background summary; do not invent credentials, job titles, dates, or statuses
- Degree status rule: if a degree is shown with a completion/graduation date, refer to it as completed/earned (never "currently pursuing")
- If timeline details are missing, avoid making timeline claims`

type MaterialType = 'resume' | 'cover_letter' | 'recruiter_message'
type ResumeLayoutPreset = 'ats_standard' | 'ats_compact' | 'ats_detailed'
type ExportFormat = 'docx_formatted' | 'docx_minimal' | 'pdf_formatted'
type OverwriteStrategy = 'prompt' | 'overwrite' | 'new'
type DiffOpType = 'equal' | 'add' | 'remove'
type RowSideStatus = ResumeCompareRowSideStatus

type CompareRow = {
  leftLine: string
  rightLine: string
  leftStatus: RowSideStatus
  rightStatus: RowSideStatus
  leftNum: number | null
  rightNum: number | null
}

type WordDiffToken = ResumeCompareWordToken

type ResumeLineKind = ResumeCompareLineKind
type BaseAnnotatedRow = ResumeCompareAnnotatedRow
type SelectionRevisionAnchor = {
  from: number
  to: number
  selectedText: string
  left: number
  top: number
}

const SELECTION_REVISION_PRESETS: Array<{ label: string; prompt: string }> = [
  { label: 'Shorten', prompt: 'Shorten and tighten wording' },
  { label: 'Clarify', prompt: 'Improve clarity and flow' },
  { label: 'Boost Impact', prompt: 'Increase impact with stronger action verbs' },
  { label: 'ATS Keywords', prompt: 'Add ATS-friendly keywords naturally' },
]

const SYSTEM_PROMPTS: Record<MaterialType, string> = {
  resume: RESUME_SYSTEM,
  cover_letter: COVER_LETTER_SYSTEM,
  recruiter_message: RECRUITER_SYSTEM,
}

const TYPE_LABELS: Record<MaterialType, string> = {
  resume: 'Resume',
  cover_letter: 'Cover Letter',
  recruiter_message: 'Recruiter Message',
}

const LAYOUT_OPTIONS: Array<{ value: ResumeLayoutPreset; label: string }> = [
  { value: 'ats_standard', label: 'ATS Standard (Recommended)' },
  { value: 'ats_compact', label: 'ATS Compact' },
  { value: 'ats_detailed', label: 'ATS Detailed' },
]

interface Props {
  job: Job
  type: MaterialType
  onInlineCompareChange?: (open: boolean) => void
}

function sanitizeStem(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120)
}

function slugFromTitle(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

function buildDefaultFileStem(prefix: string, title: string): string {
  const safePrefix = sanitizeStem(prefix || 'Candidate') || 'Candidate'
  const role = slugFromTitle(title) || 'Role'
  return sanitizeStem(`${safePrefix}_${role}`) || `${safePrefix}_Role`
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

function getPreviewLayoutConfig(preset: ResumeLayoutPreset): {
  fontFamily: string
  bodyPx: number
  namePx: number
  contactPx: number
  headingPx: number
  lineHeight: number
} {
  if (preset === 'ats_compact') {
    return { fontFamily: '"Times New Roman", Times, serif', bodyPx: 13, namePx: 20, contactPx: 12, headingPx: 15, lineHeight: 1.25 }
  }
  if (preset === 'ats_detailed') {
    return { fontFamily: '"Times New Roman", Times, serif', bodyPx: 15, namePx: 23, contactPx: 14, headingPx: 16, lineHeight: 1.35 }
  }
  return { fontFamily: '"Times New Roman", Times, serif', bodyPx: 14, namePx: 21, contactPx: 13, headingPx: 16, lineHeight: 1.3 }
}

function isLikelyNameLine(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t || t.length > 60) return false
  if (/[0-9@|]/.test(t)) return false
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
  return words.length <= 5 && trimmed === trimmed.toUpperCase()
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function extractTopLevelBlocksFromHtml(html: string): string[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html')
  const blocks: string[] = []

  Array.from(doc.body.children).forEach((el) => {
    const tag = el.tagName.toLowerCase()
    if (tag === 'ul' || tag === 'ol') {
      Array.from(el.querySelectorAll('li')).forEach((li) => {
        const text = (li.textContent || '').replace(/\s+/g, ' ').trim()
        if (text) blocks.push(`• ${text}`)
      })
      return
    }
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
    if (text) blocks.push(text)
  })

  if (blocks.length === 0) {
    const plain = (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
    if (plain) blocks.push(plain)
  }

  return blocks
}

function buildMinimalPreviewHtml(sourceHtml: string, materialType: MaterialType): string {
  const blocks = extractTopLevelBlocksFromHtml(sourceHtml)
  return blocks.map((text, idx) => {
    if (materialType === 'resume' && idx === 0 && isLikelyNameLine(text)) {
      return `<p class="preview-name-line">${escapeHtml(text)}</p>`
    }
    if (materialType === 'resume' && idx === 1 && isLikelyContactLine(text)) {
      return `<p class="preview-contact-line">${escapeHtml(text)}</p>`
    }
    if (materialType === 'resume' && isLikelySectionHeading(text)) {
      return `<p class="preview-section-heading">${escapeHtml(text.toUpperCase())}</p>`
    }
    return `<p>${escapeHtml(text)}</p>`
  }).join('')
}

function buildFormattedPreviewHtml(sourceHtml: string, materialType: MaterialType): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<body>${sourceHtml}</body>`, 'text/html')

  if (materialType === 'resume') {
    Array.from(doc.body.children).forEach((el, idx) => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (!text) return

      if (idx === 0 && isLikelyNameLine(text)) {
        el.classList.add('preview-name-line')
        return
      }

      if (idx === 1 && isLikelyContactLine(text)) {
        el.classList.add('preview-contact-line')
        return
      }

      const tag = el.tagName.toLowerCase()
      if ((tag === 'p' || tag === 'div' || tag === 'span') && isLikelySectionHeading(text)) {
        const heading = doc.createElement('h2')
        heading.textContent = text.toUpperCase()
        el.replaceWith(heading)
      }
    })
  }

  return doc.body.innerHTML
}

function getPreviewHtml(sourceHtml: string, previewFormat: ExportFormat, materialType: MaterialType): string {
  if (!sourceHtml.trim()) return '<p></p>'
  if (previewFormat === 'docx_minimal') return buildMinimalPreviewHtml(sourceHtml, materialType)
  return buildFormattedPreviewHtml(sourceHtml, materialType)
}

function getPreviewFormatLabel(format: ExportFormat): string {
  if (format === 'docx_formatted') return 'Formatted Word'
  if (format === 'docx_minimal') return 'Minimal Word'
  return 'Formatted PDF'
}

function isBulletLine(text: string): boolean {
  const t = text.trim()
  return /^([•●▪◦*-]|\d+[.)])\s+/.test(t)
}

function stripBulletPrefix(text: string): string {
  return text.trim().replace(/^([•●▪◦*-]|\d+[.)])\s+/, '')
}

function buildEditorHtmlFromText(sourceText: string, materialType: MaterialType): string {
  const normalized = sourceText.replace(/\r/g, '')
  if (!normalized.trim()) return '<p></p>'

  if (materialType !== 'resume') {
    return `<p>${escapeHtml(normalized).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`
  }

  const lines = normalized.split('\n')
  const html: string[] = []
  let nonEmptySeen = 0
  let idx = 0

  while (idx < lines.length) {
    const trimmed = lines[idx].trim()
    if (!trimmed) {
      idx++
      continue
    }

    if (nonEmptySeen === 0 && isLikelyNameLine(trimmed)) {
      html.push(`<h1>${escapeHtml(trimmed)}</h1>`)
      nonEmptySeen++
      idx++
      continue
    }

    if (nonEmptySeen <= 1 && isLikelyContactLine(trimmed)) {
      html.push(`<h3>${escapeHtml(trimmed)}</h3>`)
      nonEmptySeen++
      idx++
      continue
    }

    if (isLikelySectionHeading(trimmed)) {
      html.push(`<h2>${escapeHtml(trimmed.toUpperCase())}</h2>`)
      nonEmptySeen++
      idx++
      continue
    }

    if (isBulletLine(trimmed)) {
      const items: string[] = []
      while (idx < lines.length && isBulletLine(lines[idx].trim())) {
        items.push(stripBulletPrefix(lines[idx]))
        idx++
      }
      html.push(`<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`)
      nonEmptySeen += items.length
      continue
    }

    html.push(`<p>${escapeHtml(trimmed)}</p>`)
    nonEmptySeen++
    idx++
  }

  return html.length ? html.join('') : '<p></p>'
}

function inferResumeLineKind(line: string, lineIndex: number): ResumeLineKind {
  const trimmed = line.trim()
  if (!trimmed) return 'paragraph'
  if (lineIndex === 0 && isLikelyNameLine(trimmed)) return 'name'
  if (lineIndex <= 1 && isLikelyContactLine(trimmed)) return 'contact'
  if (isLikelySectionHeading(trimmed)) return 'heading'
  if (isBulletLine(trimmed)) return 'bullet'
  return 'paragraph'
}

function normalizeHeadingKey(line: string): string {
  return line
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function parseResumeSections(text: string): {
  headerLines: string[]
  sections: Array<{ heading: string; headingKey: string; lines: string[] }>
} {
  const lines = splitLines(text)
  const headerLines: string[] = []
  const sections: Array<{ heading: string; headingKey: string; lines: string[] }> = []
  let currentSection: { heading: string; headingKey: string; lines: string[] } | null = null

  lines.forEach((rawLine) => {
    const line = rawLine.replace(/\s+$/g, '')
    const trimmed = line.trim()
    if (isLikelySectionHeading(trimmed)) {
      currentSection = {
        heading: trimmed.toUpperCase(),
        headingKey: normalizeHeadingKey(trimmed),
        lines: [],
      }
      sections.push(currentSection)
      return
    }

    if (!currentSection) {
      if (trimmed) headerLines.push(trimmed)
      return
    }

    currentSection.lines.push(trimmed)
  })

  return { headerLines, sections }
}

function buildResumeLayoutHint(baseContent: string): string {
  const parsed = parseResumeSections(baseContent)
  if (parsed.sections.length === 0) return ''
  const orderedSections = parsed.sections.map(s => s.heading).join(' -> ')
  return [
    'Layout constraints (must follow):',
    `- Preserve the same section order and section names as the base resume: ${orderedSections}`,
    '- Keep the top header layout style aligned to the base resume (name line, contact line, section spacing, bullets).',
    '- Keep each experience entry boundary intact: do not move content between different employer/lab/role/date blocks.',
    '- Edit bullet wording within the same role block only; avoid importing domain claims from other roles.',
    '- Keep the Publications section content unchanged unless the user explicitly asks to edit publications.',
    '- Prefer editing wording within existing sections rather than inventing a new structure.',
  ].join('\n')
}

function isExperienceSectionHeadingKey(headingKey: string): boolean {
  return headingKey.includes('experience') || headingKey.includes('employment') || headingKey.includes('research')
}

function isLikelyJobEntryStartLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (isBulletLine(t)) return false
  if (isLikelySectionHeading(t)) return false
  if (t.length < 12) return false
  if (/[A-Z][a-z]+,\s*[A-Z]{2}\b/.test(t)) return true
  if (
    /,/.test(t)
    && /\b(university|institute|laboratory|hospital|department|college|school|center|therapeutics|biomedical|engineering|research)\b/i.test(t)
  ) return true
  return false
}

function addSpacingBetweenExperienceEntries(lines: string[]): string[] {
  if (lines.length < 3) return lines
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const prev = out.length > 0 ? out[out.length - 1] : ''

    const shouldInsertSpacer =
      i > 0
      && !!prev
      && isLikelyJobEntryStartLine(line)
      && (isBulletLine(prev) || /\b(19|20)\d{2}\b/.test(prev))

    if (shouldInsertSpacer && out[out.length - 1] !== '') out.push('')
    out.push(line)
  }

  return out
}

function enforceResumeLayoutFromBase(generatedText: string, baseText: string): string {
  if (!generatedText.trim() || !baseText.trim()) return generatedText

  const baseParsed = parseResumeSections(baseText)
  const generatedParsed = parseResumeSections(generatedText)
  if (baseParsed.sections.length === 0 || generatedParsed.sections.length === 0) return generatedText

  const sectionPool = new Map<string, Array<{ heading: string; lines: string[] }>>()
  generatedParsed.sections.forEach((section) => {
    const list = sectionPool.get(section.headingKey) || []
    list.push({ heading: section.heading, lines: section.lines })
    sectionPool.set(section.headingKey, list)
  })

  const orderedSections: Array<{ heading: string; lines: string[] }> = []
  baseParsed.sections.forEach((baseSection) => {
    const candidates = sectionPool.get(baseSection.headingKey)
    if (!candidates || candidates.length === 0) return
    const candidate = candidates.shift()
    if (!candidate) return
    orderedSections.push({
      heading: baseSection.heading,
      lines: candidate.lines,
    })
  })

  // Append sections that were generated but don't exist in base, preserving their generated order.
  generatedParsed.sections.forEach((section) => {
    const remaining = sectionPool.get(section.headingKey)
    if (!remaining || remaining.length === 0) return
    const candidate = remaining.shift()
    if (!candidate) return
    orderedSections.push(candidate)
  })

  if (orderedSections.length === 0) return generatedText

  const headerLines = generatedParsed.headerLines.length > 0
    ? generatedParsed.headerLines
    : baseParsed.headerLines

  const out: string[] = []
  if (headerLines.length > 0) {
    out.push(...headerLines)
    out.push('')
  }

  orderedSections.forEach((section, idx) => {
    out.push(section.heading)
    let normalizedLines = section.lines
      .map(line => line.trim())
      .filter((line, index, arr) => !(line === '' && arr[index - 1] === ''))
    if (isExperienceSectionHeadingKey(normalizeHeadingKey(section.heading))) {
      normalizedLines = addSpacingBetweenExperienceEntries(normalizedLines)
    }
    out.push(...normalizedLines)
    if (idx < orderedSections.length - 1) out.push('')
  })

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function splitLines(value: string): string[] {
  if (!value) return []
  return value
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
}

function normalizeLineForDiff(line: string): string {
  const normalized = line
    .replace(/\u00a0/g, ' ')
    .replace(/[•●▪◦]/g, ' ')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/^[\s\-*·]+/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized
}

function splitWordsForDiff(value: string): string[] {
  return value.trim().match(/\S+/g) || []
}

function normalizeWordForDiff(word: string): string {
  const normalized = word
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  return normalized || word.toLowerCase()
}

function normalizeTextForDiff(value: string): string {
  return splitWordsForDiff(value)
    .map(normalizeWordForDiff)
    .filter(Boolean)
    .join(' ')
}

function computeWordDiff(before: string, after: string): Array<{ type: DiffOpType; word: string; key: string }> {
  const a = splitWordsForDiff(before)
  const b = splitWordsForDiff(after)
  const aKey = a.map(normalizeWordForDiff)
  const bKey = b.map(normalizeWordForDiff)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = aKey[i - 1] === bKey[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const reversed: Array<{ type: DiffOpType; word: string; key: string }> = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aKey[i - 1] === bKey[j - 1]) {
      reversed.push({ type: 'equal', word: b[j - 1], key: bKey[j - 1] })
      i--
      j--
      continue
    }

    if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ type: 'add', word: b[j - 1], key: bKey[j - 1] })
      j--
      continue
    }

    reversed.push({ type: 'remove', word: a[i - 1], key: aKey[i - 1] })
    i--
  }

  return reversed.reverse()
}

function buildWordDiffTokens(before: string, after: string): { left: WordDiffToken[]; right: WordDiffToken[] } {
  const ops = computeWordDiff(before, after)
  const left: WordDiffToken[] = []
  const right: WordDiffToken[] = []

  ops.forEach((op) => {
    if (op.type === 'equal') {
      left.push({ text: op.word, changed: false })
      right.push({ text: op.word, changed: false })
      return
    }
    if (op.type === 'remove') {
      left.push({ text: op.word, changed: true })
      return
    }
    right.push({ text: op.word, changed: true })
  })

  return { left, right }
}

function tokenizeLineForSimilarity(line: string): Set<string> {
  const words = splitWordsForDiff(line)
    .map(normalizeWordForDiff)
    .filter(Boolean)
  return new Set(words)
}

function scoreLineSimilarity(a: string, b: string): number {
  const aSet = tokenizeLineForSimilarity(a)
  const bSet = tokenizeLineForSimilarity(b)
  if (aSet.size === 0 || bSet.size === 0) return 0

  let intersection = 0
  aSet.forEach((word) => {
    if (bSet.has(word)) intersection++
  })

  return intersection / Math.max(aSet.size, bSet.size)
}

function pairDiffBlock(
  removedOps: Array<{ line: string; key: string }>,
  addedOps: Array<{ line: string; key: string }>
): Array<{ removed?: { line: string; key: string }; added?: { line: string; key: string } }> {
  const usedAddedIndexes = new Set<number>()
  const pairs: Array<{ removed?: { line: string; key: string }; added?: { line: string; key: string } }> = []

  removedOps.forEach((removed) => {
    let bestIdx = -1
    let bestScore = 0

    addedOps.forEach((added, idx) => {
      if (usedAddedIndexes.has(idx)) return
      const score = scoreLineSimilarity(removed.line, added.line)
      if (score > bestScore) {
        bestScore = score
        bestIdx = idx
      }
    })

    // Pair replacements when there is meaningful overlap to support word-level highlighting.
    if (bestIdx >= 0 && bestScore >= 0.18) {
      usedAddedIndexes.add(bestIdx)
      pairs.push({ removed, added: addedOps[bestIdx] })
      return
    }

    pairs.push({ removed })
  })

  addedOps.forEach((added, idx) => {
    if (usedAddedIndexes.has(idx)) return
    pairs.push({ added })
  })

  return pairs
}

function computeLineDiff(before: string, after: string): Array<{ type: DiffOpType; line: string; key: string }> {
  const a = splitLines(before)
  const b = splitLines(after)
  const aKey = a.map(normalizeLineForDiff)
  const bKey = b.map(normalizeLineForDiff)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = aKey[i - 1] === bKey[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const reversed: Array<{ type: DiffOpType; line: string; key: string }> = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aKey[i - 1] === bKey[j - 1]) {
      reversed.push({ type: 'equal', line: b[j - 1], key: bKey[j - 1] })
      i--
      j--
      continue
    }

    if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ type: 'add', line: b[j - 1], key: bKey[j - 1] })
      j--
      continue
    }

    reversed.push({ type: 'remove', line: a[i - 1], key: aKey[i - 1] })
    i--
  }

  return reversed.reverse()
}

function toLineCountMap(lines: Array<{ key: string }>): Map<string, number> {
  const map = new Map<string, number>()
  lines.forEach(({ key }) => map.set(key, (map.get(key) || 0) + 1))
  return map
}

function consumeLine(map: Map<string, number>, key: string): boolean {
  const count = map.get(key) || 0
  if (count <= 0) return false
  if (count === 1) map.delete(key)
  else map.set(key, count - 1)
  return true
}

function getLatestAssistantText(messages: ChatMessage[] | undefined): string {
  if (!messages || messages.length === 0) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i].content || ''
  }
  return ''
}

function classifyAddedLine(
  key: string,
  hasAiSnapshot: boolean,
  aiAddedMap: Map<string, number>,
  manualAddedMap: Map<string, number>
): RowSideStatus {
  if (!hasAiSnapshot) return 'manual'
  if (consumeLine(manualAddedMap, key)) return 'manual'
  if (consumeLine(aiAddedMap, key)) return 'api'
  return 'manual'
}

function isWordIdenticalDiffBlock(
  removedOps: Array<{ line: string; key: string }>,
  addedOps: Array<{ line: string; key: string }>
): boolean {
  if (removedOps.length === 0 || addedOps.length === 0) return false
  const removedWords = normalizeTextForDiff(removedOps.map(op => op.line).join(' '))
  const addedWords = normalizeTextForDiff(addedOps.map(op => op.line).join(' '))
  return !!removedWords && removedWords === addedWords
}

function consumeAddedOpsFromClassifiers(
  addedOps: Array<{ key: string }>,
  hasAiSnapshot: boolean,
  aiAddedMap: Map<string, number>,
  manualAddedMap: Map<string, number>
): void {
  if (!hasAiSnapshot) return
  addedOps.forEach((added) => {
    if (!added.key) return
    classifyAddedLine(added.key, hasAiSnapshot, aiAddedMap, manualAddedMap)
  })
}

function reconcileMovedUnchangedRows(
  rows: CompareRow[],
  stats: { api: number; manual: number; removed: number; unchanged: number }
): { rows: CompareRow[]; stats: { api: number; manual: number; removed: number; unchanged: number } } {
  const nextRows = rows.map(row => ({ ...row }))
  const nextStats = { ...stats }
  const removedByKey = new Map<string, number[]>()

  nextRows.forEach((row, idx) => {
    const isRemovedOnly = row.leftStatus === 'removed' && row.rightStatus === 'empty' && !!row.leftLine
    if (!isRemovedOnly) return
    const key = normalizeLineForDiff(row.leftLine)
    if (!key) return
    const indexes = removedByKey.get(key) || []
    indexes.push(idx)
    removedByKey.set(key, indexes)
  })

  nextRows.forEach((row, idx) => {
    const isAddedOnly = row.leftStatus === 'empty' && !!row.rightLine && (row.rightStatus === 'api' || row.rightStatus === 'manual')
    if (!isAddedOnly) return

    const key = normalizeLineForDiff(row.rightLine)
    if (!key) return
    const candidates = removedByKey.get(key)
    if (!candidates || candidates.length === 0) return

    let bestCandidatePos = 0
    let bestDistance = Number.POSITIVE_INFINITY
    candidates.forEach((candidateIdx, pos) => {
      const dist = Math.abs(candidateIdx - idx)
      if (dist < bestDistance) {
        bestDistance = dist
        bestCandidatePos = pos
      }
    })

    const [removedIdx] = candidates.splice(bestCandidatePos, 1)
    if (candidates.length === 0) removedByKey.delete(key)
    if (removedIdx === undefined) return

    const removedRow = nextRows[removedIdx]
    const rightStatus = row.rightStatus

    nextRows[idx] = {
      ...row,
      leftLine: removedRow.leftLine,
      leftStatus: 'unchanged',
      rightStatus: 'unchanged',
      leftNum: removedRow.leftNum,
    }

    nextRows[removedIdx] = {
      leftLine: '',
      rightLine: '',
      leftStatus: 'empty',
      rightStatus: 'empty',
      leftNum: null,
      rightNum: null,
    }

    nextStats.removed = Math.max(0, nextStats.removed - 1)
    if (rightStatus === 'api') nextStats.api = Math.max(0, nextStats.api - 1)
    if (rightStatus === 'manual') nextStats.manual = Math.max(0, nextStats.manual - 1)
    nextStats.unchanged++
  })

  return {
    rows: nextRows.filter(row => row.leftStatus !== 'empty' || row.rightStatus !== 'empty'),
    stats: nextStats,
  }
}

function buildCompareRows(originalText: string, latestAiText: string, currentText: string): {
  rows: CompareRow[]
  stats: { api: number; manual: number; removed: number; unchanged: number }
} {
  if (!originalText.trim()) {
    return {
      rows: [],
      stats: { api: 0, manual: 0, removed: 0, unchanged: 0 },
    }
  }

  const normalizedOriginal = normalizeTextForDiff(originalText)
  const normalizedCurrent = normalizeTextForDiff(currentText)
  if (normalizedOriginal && normalizedOriginal === normalizedCurrent) {
    const lines = splitLines(originalText)
    return {
      rows: lines.map((line, idx) => ({
        leftLine: line,
        rightLine: line,
        leftStatus: 'unchanged',
        rightStatus: 'unchanged',
        leftNum: idx + 1,
        rightNum: idx + 1,
      })),
      stats: { api: 0, manual: 0, removed: 0, unchanged: lines.length },
    }
  }

  const hasAiSnapshot = !!latestAiText.trim()
  const currentDiff = computeLineDiff(originalText, currentText)
  const aiDiff = hasAiSnapshot ? computeLineDiff(originalText, latestAiText) : []
  const manualDiff = hasAiSnapshot ? computeLineDiff(latestAiText, currentText) : []
  const aiAddedMap = toLineCountMap(aiDiff.filter(op => op.type === 'add'))
  const manualAddedMap = toLineCountMap(manualDiff.filter(op => op.type === 'add'))

  const rows: CompareRow[] = []
  const stats = { api: 0, manual: 0, removed: 0, unchanged: 0 }
  let leftNum = 0
  let rightNum = 0
  let idx = 0

  while (idx < currentDiff.length) {
    const op = currentDiff[idx]
    if (op.type === 'equal') {
      leftNum++
      rightNum++
      rows.push({
        leftLine: op.line,
        rightLine: op.line,
        leftStatus: 'unchanged',
        rightStatus: 'unchanged',
        leftNum,
        rightNum,
      })
      stats.unchanged++
      idx++
      continue
    }

    const removedOps: Array<{ line: string; key: string }> = []
    const addedOps: Array<{ line: string; key: string }> = []
    while (idx < currentDiff.length && currentDiff[idx].type !== 'equal') {
      const diffOp = currentDiff[idx]
      if (diffOp.type === 'remove') removedOps.push({ line: diffOp.line, key: diffOp.key })
      if (diffOp.type === 'add') addedOps.push({ line: diffOp.line, key: diffOp.key })
      idx++
    }

    // Line wraps often change across sources (doc import/editor/LLM) without word-level edits.
    // When both diff sides collapse to identical word streams, treat the whole block as unchanged.
    if (isWordIdenticalDiffBlock(removedOps, addedOps)) {
      consumeAddedOpsFromClassifiers(addedOps, hasAiSnapshot, aiAddedMap, manualAddedMap)

      for (let i = 0; i < removedOps.length; i++) {
        const removed = removedOps[i]
        const added = addedOps[i]
        const leftLineNum = ++leftNum
        const rightLineNum = added ? ++rightNum : null
        rows.push({
          leftLine: removed.line,
          rightLine: added?.line || removed.line,
          leftStatus: 'unchanged',
          rightStatus: 'unchanged',
          leftNum: leftLineNum,
          rightNum: rightLineNum,
        })
        stats.unchanged++
      }

      // Consume the remaining right-side lines in this unchanged block for numbering continuity.
      for (let i = removedOps.length; i < addedOps.length; i++) rightNum++
      continue
    }

    const pairs = pairDiffBlock(removedOps, addedOps)
    for (let i = 0; i < pairs.length; i++) {
      const removed = pairs[i].removed
      const added = pairs[i].added
      if (removed && added && removed.key === added.key) {
        const leftLineNum = ++leftNum
        const rightLineNum = ++rightNum
        rows.push({
          leftLine: removed.line,
          rightLine: added.line,
          leftStatus: 'unchanged',
          rightStatus: 'unchanged',
          leftNum: leftLineNum,
          rightNum: rightLineNum,
        })
        stats.unchanged++
        continue
      }

      const rightStatus = added
        ? classifyAddedLine(added.key, hasAiSnapshot, aiAddedMap, manualAddedMap)
        : 'empty'

      const leftStatus: RowSideStatus = removed ? 'removed' : 'empty'

      const leftLineNum = removed ? ++leftNum : null
      const rightLineNum = added ? ++rightNum : null

      if (leftStatus === 'removed') stats.removed++
      if (rightStatus === 'api') stats.api++
      if (rightStatus === 'manual') stats.manual++

      rows.push({
        leftLine: removed?.line || '',
        rightLine: added?.line || '',
        leftStatus,
        rightStatus,
        leftNum: leftLineNum,
        rightNum: rightLineNum,
      })
    }
  }

  return reconcileMovedUnchangedRows(rows, stats)
}

export default function MaterialEditor({ job, type, onInlineCompareChange }: Props) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [revision, setRevision] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [resumeBases, setResumeBases] = useState<ResumeBase[]>([])
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [wordCount, setWordCount] = useState(0)
  const [wordLimit, setWordLimit] = useState(250)

  const [showExportModal, setShowExportModal] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportBaseName, setExportBaseName] = useState('')
  const [includeFormattedDocx, setIncludeFormattedDocx] = useState(true)
  const [includeMinimalDocx, setIncludeMinimalDocx] = useState(true)
  const [includePdf, setIncludePdf] = useState(true)
  const [layoutPreset, setLayoutPreset] = useState<ResumeLayoutPreset>('ats_standard')
  const [conflictingFiles, setConflictingFiles] = useState<string[]>([])
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [previewFormat, setPreviewFormat] = useState<ExportFormat>('docx_formatted')
  const [previewSourceHtml, setPreviewSourceHtml] = useState('')
  const [isCompareWindowOpen, setIsCompareWindowOpen] = useState(false)
  const [isInlineCompareOpen, setIsInlineCompareOpen] = useState(false)
  const [showCompareChanges, setShowCompareChanges] = useState(true)
  const [compareSplitPercent, setCompareSplitPercent] = useState(42)
  const [selectionRevisionAnchor, setSelectionRevisionAnchor] = useState<SelectionRevisionAnchor | null>(null)
  const [selectionRevisionPrompt, setSelectionRevisionPrompt] = useState('')
  const [isSelectionRevising, setIsSelectionRevising] = useState(false)
  const [comparisonBaseId, setComparisonBaseId] = useState<number | null>(null)
  const [comparisonBaseContent, setComparisonBaseContent] = useState('')
  const [latestAiText, setLatestAiText] = useState('')
  const [currentDraftText, setCurrentDraftText] = useState('')
  const compareSyncTimeoutRef = useRef<number | null>(null)
  const compareSplitContainerRef = useRef<HTMLDivElement | null>(null)
  const editorViewportRef = useRef<HTMLDivElement | null>(null)

  // Cover letter company research
  const [companyResearch, setCompanyResearch] = useState(job.companyResearch || '')
  const [researchExpanded, setResearchExpanded] = useState(false)
  const [fetchingResearch, setFetchingResearch] = useState(false)
  const [showResearchEdit, setShowResearchEdit] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: `${TYPE_LABELS[type]} will appear here after generation...` }),
    ],
    editorProps: { attributes: { class: `tiptap-editor material-${type}` } },
    onUpdate: ({ editor }) => {
      const text = editor.getText()
      const words = text.trim().split(/\s+/).filter(Boolean).length
      setWordCount(words)
      setCurrentDraftText(text)
    },
    onSelectionUpdate: ({ editor }) => {
      updateSelectionRevisionAnchor(editor)
    },
  })

  useEffect(() => {
    loadData()
  }, [job.id, type])

  useEffect(() => {
    const unsubscribe = window.api.onResumeCompareState((state: { open?: boolean }) => {
      setIsCompareWindowOpen(!!state?.open)
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [type])

  useEffect(() => {
    if (type === 'resume') return
    setIsCompareWindowOpen(false)
    setIsInlineCompareOpen(false)
    setShowCompareChanges(true)
    void window.api.resumeCompareClose()
  }, [type])

  useEffect(() => {
    if (!onInlineCompareChange) return
    onInlineCompareChange(type === 'resume' && isInlineCompareOpen)
  }, [isInlineCompareOpen, onInlineCompareChange, type])

  useEffect(() => {
    return () => {
      onInlineCompareChange?.(false)
    }
  }, [onInlineCompareChange])

  useEffect(() => {
    return () => {
      if (compareSyncTimeoutRef.current) {
        window.clearTimeout(compareSyncTimeoutRef.current)
        compareSyncTimeoutRef.current = null
      }
      void window.api.resumeCompareClose()
    }
  }, [])

  function setEditorTextContent(text: string) {
    editor?.commands.setContent(buildEditorHtmlFromText(text, type))
  }

  function clearSelectionRevision() {
    setSelectionRevisionAnchor(null)
    setSelectionRevisionPrompt('')
  }

  function updateSelectionRevisionAnchor(editorInstance: ReturnType<typeof useEditor>) {
    if (!editorInstance) return
    const selection = editorInstance.state.selection
    if (selection.empty) {
      setSelectionRevisionAnchor(null)
      return
    }

    const selectedText = editorInstance.state.doc.textBetween(selection.from, selection.to, ' ').trim()
    if (!selectedText) {
      setSelectionRevisionAnchor(null)
      return
    }

    const viewport = editorViewportRef.current
    if (!viewport) return

    try {
      const start = editorInstance.view.coordsAtPos(selection.from)
      const end = editorInstance.view.coordsAtPos(selection.to)
      const rect = viewport.getBoundingClientRect()
      const popoverWidth = 300
      const estimatedPopoverHeight = 150
      const selectionTop = Math.min(start.top, end.top)
      const rawLeft = ((start.left + end.right) / 2) - rect.left - (popoverWidth / 2)
      const left = Math.max(8, Math.min(rect.width - popoverWidth - 8, rawLeft))
      const top = Math.max(8, (selectionTop - rect.top + viewport.scrollTop) - estimatedPopoverHeight)

      setSelectionRevisionAnchor({
        from: selection.from,
        to: selection.to,
        selectedText,
        left,
        top,
      })
    } catch {
      setSelectionRevisionAnchor(null)
    }
  }

  async function loadData() {
    const [bases, s, mat] = await Promise.all([
      window.api.getResumeBases() as Promise<ResumeBase[]>,
      window.api.getSettings() as Promise<Record<string, unknown>>,
      window.api.jobGetMaterial(job.id, type) as Promise<{
        content?: string
        messages?: ChatMessage[]
        baseResumeId?: number
        base_resume_id?: number
      } | null>,
    ])
    setResumeBases(bases)
    setSettings(s)
    const materialContent = mat?.content || ''
    if (materialContent) {
      setEditorTextContent(materialContent)
      setMessages(mat.messages || [])
    } else {
      editor?.commands.clearContent()
      setMessages([])
    }

    setCurrentDraftText(materialContent)
    setLatestAiText(getLatestAssistantText(mat?.messages))

    if (type === 'resume') {
      const savedBaseId = Number(mat?.baseResumeId ?? mat?.base_resume_id ?? NaN)
      const preferred = bases.find(b => b.id === savedBaseId)
        || bases.find(b => b.id === comparisonBaseId)
        || bases[0]
      if (preferred) {
        setComparisonBaseId(preferred.id)
        setComparisonBaseContent(preferred.content)
      } else {
        setComparisonBaseId(null)
        setComparisonBaseContent('')
      }
    } else {
      setComparisonBaseId(null)
      setComparisonBaseContent('')
    }
  }

  async function getBaseResumeContent(): Promise<{ baseId: number; content: string } | null> {
    if (!resumeBases.length) {
      toast('error', 'No Resume/CV vault documents configured. Add one in Settings.')
      return null
    }
    if (resumeBases.length === 1) {
      setComparisonBaseId(resumeBases[0].id)
      setComparisonBaseContent(resumeBases[0].content)
      return { baseId: resumeBases[0].id, content: resumeBases[0].content }
    }

    return new Promise((resolve) => {
      const modal = document.createElement('div')
      modal.innerHTML = `
        <div style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6)">
          <div style="background:#252525;border:1px solid #3a3a3a;border-radius:12px;padding:20px;width:320px;space-y:12px">
            <p style="color:#e8e8e8;font-size:14px;font-weight:600;margin-bottom:12px">Select resume base</p>
            ${resumeBases.map(b => `
              <button data-id="${b.id}" data-content="${encodeURIComponent(b.content)}" style="display:block;width:100%;text-align:left;padding:8px 12px;margin:4px 0;background:#2e2e2e;border:1px solid #3a3a3a;border-radius:8px;color:#e8e8e8;font-size:13px;cursor:pointer">
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
                  <span>${b.name}</span>
                  <span style="font-size:10px;color:#9e9e9e;">${(b.docType || 'resume').toUpperCase()} · v${b.activeVersion || 1}</span>
                </div>
              </button>
            `).join('')}
            <button id="cancel-base" style="display:block;width:100%;text-align:center;padding:8px;margin-top:8px;background:transparent;border:none;color:#6b6b6b;font-size:12px;cursor:pointer">Cancel</button>
          </div>
        </div>`
      document.body.appendChild(modal)
      modal.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('button[data-id]') as HTMLElement
        if (btn) {
          const id = parseInt(btn.dataset.id || '', 10)
          const content = decodeURIComponent(btn.dataset.content || '')
          setComparisonBaseId(id)
          setComparisonBaseContent(content)
          document.body.removeChild(modal)
          resolve({ baseId: id, content })
        } else if ((e.target as HTMLElement).id === 'cancel-base') {
          document.body.removeChild(modal)
          resolve(null)
        }
      })
    })
  }

  async function fetchCompanyResearch() {
    setFetchingResearch(true)
    try {
      const result = await window.api.jobFetchCompanyPage(job.company, job.url || undefined) as { success?: boolean; text?: string; error?: string }
      if (result.success && result.text) {
        setCompanyResearch(result.text)
        setShowResearchEdit(true)
        setResearchExpanded(true)
        await window.api.jobUpdate(job.id, { companyResearch: result.text })
      } else {
        toast('error', result.error || 'Could not fetch company page')
        setShowResearchEdit(true)
      }
    } catch (err) {
      toast('error', String(err))
      setShowResearchEdit(true)
    } finally {
      setFetchingResearch(false)
    }
  }

  async function handleGenerate() {
    setIsGenerating(true)
    try {
      let userContent = ''
      let baseResumeId: number | undefined
      let resumeBaseContentForRun = ''
      let runSystemPrompt = SYSTEM_PROMPTS[type]

      if (type === 'resume') {
        const base = await getBaseResumeContent()
        if (!base) { setIsGenerating(false); return }
        baseResumeId = base.baseId
        resumeBaseContentForRun = base.content
        const layoutHint = buildResumeLayoutHint(base.content)
        runSystemPrompt = layoutHint ? `${RESUME_SYSTEM}\n\n${layoutHint}` : RESUME_SYSTEM
        userContent = `Job Title: ${job.title}\nCompany: ${job.company}\nJob Description:\n${job.description || 'Not available'}\n\nRole-boundary rule (required): keep edits scoped to each existing experience role entry from the base resume. Do not mix claims across jobs.\n\nBase Resume:\n${base.content}`
      } else if (type === 'cover_letter') {
        const base = await getBaseResumeContent()
        if (!base) { setIsGenerating(false); return }
        baseResumeId = base.baseId

        if (!companyResearch && !showResearchEdit) {
          await fetchCompanyResearch()
          setIsGenerating(false)
          return
        }

        userContent = `Job Title: ${job.title}\nCompany: ${job.company}\n\nCompany Research:\n${companyResearch || 'Not available'}\n\nJob Description:\n${job.description || 'Not available'}\n\nBase Resume:\n${base.content}`
      } else {
        const base = await getBaseResumeContent()
        if (!base) { setIsGenerating(false); return }
        baseResumeId = base.baseId
        userContent = `Write a recruiter message for this role in about ${wordLimit} words (do not exceed ${wordLimit} words).\nJob: ${job.title} at ${job.company}\n${job.location ? `Location: ${job.location}` : ''}\n\nJob Description:\n${job.description || 'Not available'}\n\nCandidate background summary (source of truth; use only these facts):\n${base.content.slice(0, 8000)}`
      }

      const models = settings.models as Record<string, string> || {}
      const modelKey = type === 'resume' ? 'resumeGenerator' : type === 'cover_letter' ? 'coverLetterGenerator' : 'qaGenerator'
      const model = models[modelKey] || 'claude-sonnet-4-6'
      const provider = model.startsWith('gpt') ? 'openai' : 'anthropic'

      const newMessages: ChatMessage[] = [{ role: 'user', content: userContent }]
      setMessages(newMessages)

      const result = await window.api.llmCall({
        provider, model, messages: newMessages, systemPrompt: runSystemPrompt,
      }) as { content: string }

      const finalContent = type === 'resume'
        ? enforceResumeLayoutFromBase(result.content, resumeBaseContentForRun || comparisonBaseContent)
        : result.content

      setEditorTextContent(finalContent)
      setCurrentDraftText(finalContent)
      setLatestAiText(finalContent)
      const updatedMessages: ChatMessage[] = [...newMessages, { role: 'assistant', content: finalContent }]
      setMessages(updatedMessages)

      await window.api.jobSaveMaterial({
        jobId: job.id,
        type,
        content: finalContent,
        messages: updatedMessages,
        baseResumeId,
      })
    } catch (err) {
      toast('error', String(err), true)
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleRevision() {
    if (!revision.trim()) return
    setIsGenerating(true)
    const currentText = editor?.getText() || ''
    const resumeBaseForRevision = type === 'resume'
      ? (comparisonBaseContent.trim() || resumeBases[0]?.content || '')
      : ''
    const revisionLayoutHint = type === 'resume' ? buildResumeLayoutHint(resumeBaseForRevision) : ''
    const revisionSystemPrompt = type === 'resume'
      ? (revisionLayoutHint ? `${RESUME_SYSTEM}\n\n${revisionLayoutHint}` : RESUME_SYSTEM)
      : SYSTEM_PROMPTS[type]
    const trimmedRevision = revision.trim()
    const revisionUserContent = type === 'resume' && resumeBaseForRevision.trim()
      ? `Revision request:\n${trimmedRevision}\n\nRole-boundary rule (required): keep edits scoped to each existing experience role entry from this base resume. Do not mix claims across jobs.\n\nBase Resume:\n${resumeBaseForRevision}`
      : trimmedRevision

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: currentText },
      { role: 'user', content: revisionUserContent },
    ]
    setMessages(newMessages)
    setRevision('')

    try {
      const models = settings.models as Record<string, string> || {}
      const modelKey = type === 'resume' ? 'resumeGenerator' : type === 'cover_letter' ? 'coverLetterGenerator' : 'qaGenerator'
      const model = models[modelKey] || 'claude-sonnet-4-6'
      const provider = model.startsWith('gpt') ? 'openai' : 'anthropic'

      const result = await window.api.llmCall({
        provider, model, messages: newMessages, systemPrompt: revisionSystemPrompt,
      }) as { content: string }

      const finalContent = type === 'resume' && resumeBaseForRevision
        ? enforceResumeLayoutFromBase(result.content, resumeBaseForRevision)
        : result.content

      setEditorTextContent(finalContent)
      setCurrentDraftText(finalContent)
      setLatestAiText(finalContent)
      const updatedMessages: ChatMessage[] = [...newMessages, { role: 'assistant', content: finalContent }]
      setMessages(updatedMessages)
      await window.api.jobSaveMaterial({ jobId: job.id, type, content: finalContent, messages: updatedMessages })
    } catch (err) {
      toast('error', String(err), true)
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleSelectionRevision(promptOverride?: string) {
    if (!editor || !selectionRevisionAnchor) return
    const instruction = (promptOverride ?? selectionRevisionPrompt).trim()
    if (!instruction) return
    setIsSelectionRevising(true)
    const currentText = editor.getText()
    const baseForResume = type === 'resume' ? (comparisonBaseContent.trim() || resumeBases[0]?.content || '') : ''
    const revisionLayoutHint = type === 'resume' ? buildResumeLayoutHint(baseForResume) : ''
    const revisionSystemPrompt = type === 'resume'
      ? (revisionLayoutHint ? `${RESUME_SYSTEM}\n\n${revisionLayoutHint}` : RESUME_SYSTEM)
      : SYSTEM_PROMPTS[type]

    try {
      const models = settings.models as Record<string, string> || {}
      const modelKey = type === 'resume' ? 'resumeGenerator' : type === 'cover_letter' ? 'coverLetterGenerator' : 'qaGenerator'
      const model = models[modelKey] || 'claude-sonnet-4-6'
      const provider = model.startsWith('gpt') ? 'openai' : 'anthropic'

      const selectionRequest = [
        `Revise only the selected excerpt in this ${TYPE_LABELS[type]}.`,
        'Return ONLY replacement text for the selected excerpt (no labels, no quotes, no markdown).',
        type === 'resume'
          ? 'Keep claims strictly scoped to the same role entry from the base resume; do not blend achievements across jobs.'
          : '',
        `Instruction: ${instruction}`,
        `Selected excerpt:\n${selectionRevisionAnchor.selectedText}`,
        `Full document context:\n${currentText}`,
        type === 'resume' && baseForResume
          ? `Base resume (source constraints):\n${baseForResume}`
          : '',
      ].filter(Boolean).join('\n\n')

      const result = await window.api.llmCall({
        provider,
        model,
        messages: [{ role: 'user', content: selectionRequest }],
        systemPrompt: revisionSystemPrompt,
      }) as { content: string }

      const replacement = (result.content || '')
        .replace(/^```[a-zA-Z]*\n?/, '')
        .replace(/\n?```$/, '')
        .trim()

      if (!replacement) {
        toast('error', 'Selection revision returned empty text.')
        return
      }

      editor.chain()
        .focus()
        .setTextSelection({ from: selectionRevisionAnchor.from, to: selectionRevisionAnchor.to })
        .insertContent(replacement)
        .run()

      const updatedText = editor.getText()
      const revisionSummary = `Selection revision request: ${instruction}`
      const updatedMessages: ChatMessage[] = [
        ...messages,
        { role: 'assistant', content: currentText },
        { role: 'user', content: revisionSummary },
        { role: 'assistant', content: updatedText },
      ]
      setMessages(updatedMessages)
      setCurrentDraftText(updatedText)
      if (type === 'resume') setLatestAiText(updatedText)

      await window.api.jobSaveMaterial({
        jobId: job.id,
        type,
        content: updatedText,
        messages: updatedMessages,
        ...(type === 'resume' && comparisonBaseId ? { baseResumeId: comparisonBaseId } : {}),
      })

      clearSelectionRevision()
      toast('success', 'Selection revised')
    } catch (err) {
      toast('error', String(err), true)
    } finally {
      setIsSelectionRevising(false)
    }
  }

  function openExportModal() {
    if (!editor) return
    const prefix = (settings.exportNamePrefix as string) || ''
    const preset = (settings.resumeLayoutPreset as ResumeLayoutPreset) || 'ats_standard'
    setExportBaseName(buildDefaultFileStem(prefix, job.title))
    setLayoutPreset(preset)
    setIncludeFormattedDocx(true)
    setIncludeMinimalDocx(type === 'resume')
    setIncludePdf(true)
    setConflictingFiles([])
    setShowExportModal(true)
  }

  function openPreviewModal() {
    if (!editor) return
    const options: ExportFormat[] = type === 'resume'
      ? ['docx_formatted', 'docx_minimal', 'pdf_formatted']
      : ['docx_formatted', 'pdf_formatted']

    const selected = [
      includeFormattedDocx ? 'docx_formatted' as const : null,
      includeMinimalDocx && type === 'resume' ? 'docx_minimal' as const : null,
      includePdf ? 'pdf_formatted' as const : null,
    ].filter(Boolean) as ExportFormat[]

    setPreviewFormat(selected[0] || options[0])
    setPreviewSourceHtml(editor.getHTML())
    setShowPreviewModal(true)
  }

  async function handleSaveExport(overwriteStrategy: OverwriteStrategy = 'prompt') {
    if (!editor) return

    const formats: ExportFormat[] = []
    if (includeFormattedDocx) formats.push('docx_formatted')
    if (includeMinimalDocx && type === 'resume') formats.push('docx_minimal')
    if (includePdf) formats.push('pdf_formatted')

    if (!formats.length) {
      toast('error', 'Select at least one export type')
      return
    }

    const cleanBase = sanitizeStem(exportBaseName)
    if (!cleanBase) {
      toast('error', 'Enter a valid output file name')
      return
    }

    setIsExporting(true)
    try {
      const result = await window.api.jobExportMaterials({
        jobId: job.id,
        type,
        html: editor.getHTML(),
        baseFileName: cleanBase,
        formats,
        resumeLayoutPreset: layoutPreset,
        overwriteStrategy,
      }) as {
        success?: boolean
        error?: string
        conflict?: boolean
        existingFiles?: string[]
        files?: string[]
        dirPath?: string
      }

      if (result.success) {
        const count = result.files?.length || 0
        toast('success', count > 0
          ? `Saved ${count} file${count > 1 ? 's' : ''} to: ${result.dirPath}`
          : `Saved to: ${result.dirPath}`)
        setShowExportModal(false)
        setConflictingFiles([])
        return
      }

      if (result.conflict) {
        setConflictingFiles(result.existingFiles || [])
        return
      }

      toast('error', result.error || 'Export failed')
    } catch (err) {
      toast('error', String(err))
    } finally {
      setIsExporting(false)
    }
  }

  function handleCopy() {
    if (!editor) return
    const text = editor.getText()
    navigator.clipboard.writeText(text)
    toast('success', 'Copied to clipboard')
  }

  function handleComparisonBaseChange(baseId: number) {
    if (!Number.isFinite(baseId)) return
    const base = resumeBases.find(b => b.id === baseId)
    if (!base) return
    setComparisonBaseId(base.id)
    setComparisonBaseContent(base.content)
  }

  const isRecruiter = type === 'recruiter_message'
  const outputRoot = ((settings.outputFolder as string) || '').replace(/\/$/, '')
  const destinationFolder = outputRoot ? `${outputRoot}/${job.company} — ${job.title}` : `${job.company} — ${job.title}`
  const previewLayout = useMemo(() => getPreviewLayoutConfig(layoutPreset), [layoutPreset])
  const previewHtml = useMemo(
    () => getPreviewHtml(previewSourceHtml, previewFormat, type),
    [previewSourceHtml, previewFormat, type]
  )
  const compareData = useMemo(
    () => buildCompareRows(comparisonBaseContent, latestAiText, currentDraftText),
    [comparisonBaseContent, latestAiText, currentDraftText]
  )
  const hasCompareRows = compareData.rows.length > 0
  const baseAnnotatedRows = useMemo<BaseAnnotatedRow[]>(() => {
    const rows: BaseAnnotatedRow[] = []
    let baseLineIndex = 0

    compareData.rows.forEach((row, idx) => {
      if (row.leftLine) {
        const kind = inferResumeLineKind(row.leftLine, baseLineIndex)
        const leftText = kind === 'bullet' ? stripBulletPrefix(row.leftLine) : row.leftLine
        const rightKind = row.rightLine ? inferResumeLineKind(row.rightLine, baseLineIndex) : 'paragraph'
        const rightText = row.rightLine
          ? (rightKind === 'bullet' ? stripBulletPrefix(row.rightLine) : row.rightLine)
          : ''
        const shouldDiffWords = !!row.rightLine && (row.leftStatus !== 'unchanged' || row.rightStatus !== 'unchanged')
        const wordDiff = shouldDiffWords ? buildWordDiffTokens(leftText, rightText) : null

        rows.push({
          key: `base-${idx}-${row.leftNum ?? 'x'}`,
          kind,
          baseTokens: wordDiff
            ? wordDiff.left
            : splitWordsForDiff(leftText).map(text => ({ text, changed: false })),
          insertedTokens: wordDiff ? wordDiff.right : [],
          insertedStatus: row.rightStatus,
          insertionOnly: false,
        })
        baseLineIndex++
        return
      }

      if (!row.rightLine) return
      const kind = inferResumeLineKind(row.rightLine, baseLineIndex)
      const insertedText = kind === 'bullet' ? stripBulletPrefix(row.rightLine) : row.rightLine
      rows.push({
        key: `ins-${idx}-${row.rightNum ?? 'x'}`,
        kind,
        baseTokens: [],
        insertedTokens: splitWordsForDiff(insertedText).map(text => ({ text, changed: true })),
        insertedStatus: row.rightStatus,
        insertionOnly: true,
      })
    })

    return rows
  }, [compareData.rows])
  const selectedBaseName = useMemo(
    () => (comparisonBaseId ? (resumeBases.find(base => base.id === comparisonBaseId)?.name || '') : ''),
    [comparisonBaseId, resumeBases]
  )
  const compareWindowPayload = useMemo<ResumeCompareWindowPayload>(() => ({
    jobId: job.id,
    company: job.company,
    jobTitle: job.title,
    baseResumeName: selectedBaseName,
    hasBaseContent: !!comparisonBaseContent.trim(),
    hasCompareRows,
    rows: baseAnnotatedRows,
    stats: compareData.stats,
  }), [
    baseAnnotatedRows,
    compareData.stats,
    comparisonBaseContent,
    hasCompareRows,
    job.company,
    job.id,
    job.title,
    selectedBaseName,
  ])

  useEffect(() => {
    if (type !== 'resume' || !isCompareWindowOpen) return
    if (compareSyncTimeoutRef.current) window.clearTimeout(compareSyncTimeoutRef.current)
    compareSyncTimeoutRef.current = window.setTimeout(() => {
      void window.api.resumeCompareUpdate(compareWindowPayload)
    }, 70)
    return () => {
      if (compareSyncTimeoutRef.current) {
        window.clearTimeout(compareSyncTimeoutRef.current)
        compareSyncTimeoutRef.current = null
      }
    }
  }, [compareWindowPayload, isCompareWindowOpen, type])

  async function toggleCompareWindow() {
    if (type !== 'resume') return
    if (!comparisonBaseContent.trim()) {
      toast('error', 'Select a base resume before comparing.')
      return
    }
    try {
      if (isCompareWindowOpen) {
        await window.api.resumeCompareClose()
        setIsCompareWindowOpen(false)
        return
      }

      await window.api.resumeCompareOpen(compareWindowPayload)
      setIsCompareWindowOpen(true)
    } catch (err) {
      toast('error', String(err))
    }
  }

  function toggleInlineCompare() {
    if (type !== 'resume') return
    if (!comparisonBaseContent.trim()) {
      toast('error', 'Select a base resume before comparing.')
      return
    }
    setIsInlineCompareOpen(prev => !prev)
  }

  function handleCompareDividerMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (type !== 'resume' || !isInlineCompareOpen) return
    const container = compareSplitContainerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const minPercent = 28
    const maxPercent = 68

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const next = ((moveEvent.clientX - rect.left) / rect.width) * 100
      const clamped = Math.max(minPercent, Math.min(maxPercent, next))
      setCompareSplitPercent(clamped)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    event.preventDefault()
  }

  function renderEditorPane() {
    return (
      <div
        ref={editorViewportRef}
        className="h-full overflow-y-auto relative"
        onScroll={() => {
          if (editor && selectionRevisionAnchor) updateSelectionRevisionAnchor(editor)
        }}
      >
        {isGenerating && (
          <div className="absolute inset-0 z-10 bg-bg/80 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={22} className="animate-spin text-accent" />
              <span className="text-sm text-text-muted">Generating...</span>
            </div>
          </div>
        )}
        {selectionRevisionAnchor && (
          <div
            className="absolute z-20 w-[300px] rounded-md border border-border bg-surface p-2 shadow-xl"
            style={{ left: `${selectionRevisionAnchor.left}px`, top: `${selectionRevisionAnchor.top}px` }}
          >
            <p className="text-[10px] uppercase tracking-wider text-text-dim font-semibold mb-1">Revise Selection</p>
            <p className="text-[10px] text-text-dim truncate mb-1" title={selectionRevisionAnchor.selectedText}>
              {selectionRevisionAnchor.selectedText}
            </p>
            <input
              value={selectionRevisionPrompt}
              onChange={e => setSelectionRevisionPrompt(e.target.value)}
              placeholder="What should change?"
              className="input text-[11px] py-1"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { void handleSelectionRevision() }
                if (e.key === 'Escape') clearSelectionRevision()
              }}
            />
            <div className="flex flex-wrap gap-1 mt-1">
              {SELECTION_REVISION_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => { void handleSelectionRevision(preset.prompt) }}
                  className="btn-ghost text-[10px] py-0.5 px-1.5"
                  disabled={isSelectionRevising}
                  title={preset.prompt}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <button
                onClick={clearSelectionRevision}
                className="btn-ghost text-[11px] py-0.5 px-2"
                disabled={isSelectionRevising}
              >
                Dismiss
              </button>
              <button
                onClick={() => { void handleSelectionRevision() }}
                className="btn-secondary text-[11px] py-0.5 px-2 ml-auto"
                disabled={isSelectionRevising || !selectionRevisionPrompt.trim()}
              >
                {isSelectionRevising ? 'Revising…' : 'Apply'}
              </button>
            </div>
          </div>
        )}
        <div className="tiptap-editor">
          <EditorContent editor={editor} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {type === 'cover_letter' && (
        <div className="border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-xs font-medium text-text-muted">Company Research</span>
            <button
              onClick={() => companyResearch ? setResearchExpanded(!researchExpanded) : fetchCompanyResearch()}
              disabled={fetchingResearch}
              className="btn-ghost text-xs py-0.5"
            >
              {fetchingResearch ? <Loader2 size={11} className="animate-spin" /> : <Globe size={11} />}
              {companyResearch ? (researchExpanded ? 'Hide' : 'Show & Edit') : 'Fetch Company Info'}
            </button>
            {companyResearch && !researchExpanded && (
              <span className="text-xs text-success">✓ Research ready</span>
            )}
          </div>
          {researchExpanded && (
            <div className="px-3 pb-3">
              <textarea
                value={companyResearch}
                onChange={e => setCompanyResearch(e.target.value)}
                placeholder="Company research will appear here. Edit before generating."
                className="input resize-none text-xs"
                rows={5}
              />
              <div className="flex gap-2 mt-1.5">
                <button onClick={fetchCompanyResearch} disabled={fetchingResearch} className="btn-secondary text-xs py-1">
                  {fetchingResearch ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Re-fetch
                </button>
                <button onClick={() => { setResearchExpanded(false); setShowResearchEdit(true) }} className="btn-ghost text-xs py-1">
                  Done editing
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 p-2 border-b border-border flex-shrink-0">
        <button onClick={handleGenerate} disabled={isGenerating} className="btn-primary text-xs">
          {isGenerating ? <Loader2 size={12} className="animate-spin" /> : null}
          Generate {TYPE_LABELS[type]}
        </button>
        <div className="flex-1">
          <input
            value={revision}
            onChange={e => setRevision(e.target.value)}
            placeholder="Request a revision..."
            className="input text-xs py-1"
            onKeyDown={e => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && handleRevision()}
          />
        </div>
        <button onClick={handleRevision} disabled={!revision || isGenerating} className="btn-secondary text-xs p-1.5">
          <Send size={13} />
        </button>
        <button onClick={handleCopy} className="btn-ghost text-xs p-1.5" title="Copy">
          <Copy size={13} />
        </button>
        {type === 'resume' && (
          <button
            onClick={toggleInlineCompare}
            className="btn-ghost text-xs"
            disabled={!comparisonBaseContent.trim()}
            title={comparisonBaseContent.trim() ? 'Toggle inline compare view' : 'Select or generate with a base resume first'}
          >
            {isInlineCompareOpen ? 'Hide Compare Pane' : 'Compare Inline'}
          </button>
        )}
        {!isRecruiter && (
          <button onClick={openExportModal} className="btn-secondary text-xs" title={`Export ${TYPE_LABELS[type]}`}>
            <Download size={13} />
            Export {TYPE_LABELS[type]}
          </button>
        )}
      </div>

      {type === 'resume' && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 flex-shrink-0 flex-wrap">
          <span className="text-[10px] font-semibold text-text-dim uppercase tracking-wider">Change Legend</span>
          <select
            value={comparisonBaseId || ''}
            onChange={e => handleComparisonBaseChange(parseInt(e.target.value, 10))}
            className="input text-[11px] py-1 w-52 max-w-full"
            disabled={resumeBases.length === 0}
            title="Base resume for comparison"
          >
            {resumeBases.length === 0 && <option value="">No base resume found</option>}
            {resumeBases.map(base => (
              <option key={base.id} value={base.id}>
                {base.name}
              </option>
            ))}
          </select>
          <span className="px-1.5 py-0.5 rounded bg-success/15 text-success text-[10px]">{compareData.stats.api} API edits</span>
          <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent text-[10px]">{compareData.stats.manual} Manual edits</span>
          <span className="px-1.5 py-0.5 rounded bg-error/15 text-error text-[10px]">{compareData.stats.removed} Removed</span>
          <span className="px-1.5 py-0.5 rounded bg-surface-2 text-text-dim text-[10px]">{compareData.stats.unchanged} Unchanged</span>
          <button
            onClick={() => setShowCompareChanges(prev => !prev)}
            className="btn-ghost text-[11px] py-1 px-2"
            disabled={!comparisonBaseContent.trim()}
          >
            {showCompareChanges ? 'Hide Changes' : 'Show Changes'}
          </button>
          <button
            onClick={toggleInlineCompare}
            className="btn-ghost text-[11px] py-1 px-2 ml-auto"
            disabled={!comparisonBaseContent.trim()}
          >
            {isInlineCompareOpen ? 'Hide Compare Pane' : 'Show Compare Pane'}
          </button>
          <button
            onClick={() => { void toggleCompareWindow() }}
            className="btn-ghost text-[11px] py-1 px-2"
            disabled={!comparisonBaseContent.trim()}
          >
            {isCompareWindowOpen ? 'Close Pop Out' : 'Pop Out Compare'}
          </button>
        </div>
      )}

      {isRecruiter && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border/50 flex-shrink-0">
          <span className={`text-xs font-mono ${wordCount > wordLimit ? 'text-error' : 'text-text-muted'}`}>
            {wordCount} / {wordLimit} words
          </span>
          <input
            type="number"
            value={wordLimit}
            onChange={e => setWordLimit(parseInt(e.target.value) || 250)}
            className="input text-xs py-0.5 w-20"
            min={50}
            max={1000}
          />
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {type === 'resume' && isInlineCompareOpen ? (
          <div ref={compareSplitContainerRef} className="h-full flex overflow-hidden">
            <div
              className="h-full min-w-[280px] max-w-[72%] border-r border-border bg-bg/50 flex flex-col overflow-hidden"
              style={{ width: `${compareSplitPercent}%` }}
            >
              <div className="px-3 py-2 border-b border-border/70">
                <p className="text-[11px] uppercase tracking-wider text-text-dim font-semibold">Base Resume Compare</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-text-muted truncate">{selectedBaseName || 'No base selected'}</p>
                  <button
                    onClick={() => setShowCompareChanges(prev => !prev)}
                    className="btn-ghost text-[10px] py-0.5 px-1.5 ml-auto"
                  >
                    {showCompareChanges ? 'Changes On' : 'Changes Off'}
                  </button>
                </div>
              </div>
              <ResumeCompareContent payload={compareWindowPayload} showChanges={showCompareChanges} />
            </div>

            <div
              className="w-1.5 shrink-0 cursor-col-resize bg-border/40 hover:bg-accent/60 transition-colors"
              onMouseDown={handleCompareDividerMouseDown}
              title="Drag to resize compare panes"
            />

            <div className="flex-1 h-full overflow-hidden">
              {renderEditorPane()}
            </div>
          </div>
        ) : (
          renderEditorPane()
        )}
      </div>

      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="card w-[640px] max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Export {TYPE_LABELS[type]}</h3>
              <button onClick={() => !isExporting && setShowExportModal(false)} className="btn-ghost p-1" disabled={isExporting}>
                <X size={14} />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Destination Folder</label>
              <input value={destinationFolder} readOnly className="input text-xs cursor-default" />
              <p className="text-xs text-text-dim mt-1">Configured in Settings → Storage. Not editable in this dialog.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Output File Name Base</label>
              <input
                value={exportBaseName}
                onChange={e => setExportBaseName(e.target.value)}
                className="input"
                placeholder="Schrack_Ian_SeniorScientist"
                disabled={isExporting}
              />
              <p className="text-xs text-text-dim mt-1">Each selected export appends the document suffix and file extension automatically.</p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-text-dim uppercase tracking-wider">Export Types</p>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeFormattedDocx}
                  onChange={e => setIncludeFormattedDocx(e.target.checked)}
                  className="mt-0.5 accent-accent"
                  disabled={isExporting}
                />
                <span className="text-sm text-text">Formatted Word (.docx) — ATS-friendly layout</span>
              </label>

              {type === 'resume' && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeMinimalDocx}
                    onChange={e => setIncludeMinimalDocx(e.target.checked)}
                    className="mt-0.5 accent-accent"
                    disabled={isExporting}
                  />
                  <span className="text-sm text-text">Minimal Word (.docx) — simplified formatting for quick copy/paste</span>
                </label>
              )}

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includePdf}
                  onChange={e => setIncludePdf(e.target.checked)}
                  className="mt-0.5 accent-accent"
                  disabled={isExporting}
                />
                <span className="text-sm text-text">Formatted PDF (.pdf)</span>
              </label>
            </div>

            {type === 'resume' && includeFormattedDocx && (
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Formatted Resume Layout</label>
                <select
                  value={layoutPreset}
                  onChange={e => setLayoutPreset(e.target.value as ResumeLayoutPreset)}
                  className="input"
                  disabled={isExporting}
                >
                  {LAYOUT_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            )}

            {conflictingFiles.length > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
                <div className="flex items-center gap-2 text-warning text-xs font-medium">
                  <AlertTriangle size={13} /> Existing files found in this folder
                </div>
                <div className="max-h-28 overflow-y-auto bg-surface/70 rounded p-2 text-[11px] font-mono text-text-dim space-y-1">
                  {conflictingFiles.map(file => (
                    <div key={file}>{file}</div>
                  ))}
                </div>
                <p className="text-xs text-text-muted">Choose whether to overwrite those files or create new versioned files.</p>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => handleSaveExport('overwrite')} disabled={isExporting} className="btn-danger text-xs">
                    Overwrite Existing
                  </button>
                  <button onClick={() => handleSaveExport('new')} disabled={isExporting} className="btn-secondary text-xs">
                    Create New Files
                  </button>
                  <button onClick={() => setConflictingFiles([])} disabled={isExporting} className="btn-ghost text-xs">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={openPreviewModal} disabled={isExporting || !editor} className="btn-secondary">
                Preview
              </button>
              <button onClick={() => handleSaveExport()} disabled={isExporting} className="btn-primary flex-1 justify-center">
                {isExporting ? <Loader2 size={14} className="animate-spin" /> : null}
                Save Exports
              </button>
              <button onClick={() => !isExporting && setShowExportModal(false)} className="btn-ghost" disabled={isExporting}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {showPreviewModal && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
          <div className="card w-[980px] max-w-[95vw] h-[88vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Export Preview</h3>
                <span className="text-xs text-text-dim">{TYPE_LABELS[type]}</span>
              </div>
              <button onClick={() => setShowPreviewModal(false)} className="btn-ghost p-1">
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2 p-3 border-b border-border">
              {(type === 'resume'
                ? (['docx_formatted', 'docx_minimal', 'pdf_formatted'] as ExportFormat[])
                : (['docx_formatted', 'pdf_formatted'] as ExportFormat[])
              ).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setPreviewFormat(fmt)}
                  className={previewFormat === fmt ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
                >
                  {getPreviewFormatLabel(fmt)}
                </button>
              ))}
              <span className="text-xs text-text-dim ml-auto">Layout: {LAYOUT_OPTIONS.find(o => o.value === layoutPreset)?.label}</span>
            </div>
            <div className="flex-1 overflow-auto bg-surface-2 p-4">
              <div
                className="mx-auto bg-white text-black rounded-md border border-black/20 shadow p-[0.7in] w-full max-w-[820px]"
                style={{ fontFamily: previewLayout.fontFamily, fontSize: `${previewLayout.bodyPx}px`, lineHeight: previewLayout.lineHeight }}
              >
                <style>
                  {`
                    .preview-paper h1 { font-size: 1.4em; margin: 0 0 0.18rem; }
                    .preview-paper h2 { font-size: ${previewLayout.headingPx}px; font-weight: 700; margin: 0.35rem 0 0.12rem; }
                    .preview-paper h3 { font-size: 1.05em; font-weight: 700; margin: 0.25rem 0 0.1rem; }
                    .preview-paper p { margin: 0 0 0.28rem; }
                    .preview-paper ul, .preview-paper ol { margin: 0 0 0.3rem 1.1rem; padding: 0; }
                    .preview-paper li { margin: 0 0 0.14rem; }
                    .preview-paper .preview-name-line { text-align: center; font-size: ${previewLayout.namePx}px; font-weight: 700; margin: 0 0 0.02in; }
                    .preview-paper .preview-contact-line { text-align: center; font-size: ${previewLayout.contactPx}px; margin: 0 0 0.14in; }
                    .preview-paper .preview-section-heading { font-size: ${previewLayout.headingPx}px; font-weight: 700; margin: 0.08in 0 0.03in; text-transform: uppercase; }
                  `}
                </style>
                <div className="preview-paper" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            </div>
            <div className="p-3 border-t border-border flex justify-end">
              <button onClick={() => setShowPreviewModal(false)} className="btn-secondary">Back to Export</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
