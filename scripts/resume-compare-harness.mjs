#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

function splitLines(value) {
  if (!value) return []
  return value
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
}

function normalizeLineForDiff(line) {
  return line
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
}

function splitWordsForDiff(value) {
  return value.trim().match(/\S+/g) || []
}

function normalizeWordForDiff(word) {
  const normalized = word
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  return normalized || word.toLowerCase()
}

function normalizeTextForDiff(value) {
  return splitWordsForDiff(value)
    .map(normalizeWordForDiff)
    .filter(Boolean)
    .join(' ')
}

function tokenizeLineForSimilarity(line) {
  return new Set(splitWordsForDiff(line).map(normalizeWordForDiff).filter(Boolean))
}

function scoreLineSimilarity(a, b) {
  const aSet = tokenizeLineForSimilarity(a)
  const bSet = tokenizeLineForSimilarity(b)
  if (aSet.size === 0 || bSet.size === 0) return 0
  let intersection = 0
  aSet.forEach((word) => { if (bSet.has(word)) intersection++ })
  return intersection / Math.max(aSet.size, bSet.size)
}

function pairDiffBlock(removedOps, addedOps) {
  const usedAdded = new Set()
  const pairs = []

  removedOps.forEach((removed) => {
    let bestIdx = -1
    let bestScore = 0
    addedOps.forEach((added, idx) => {
      if (usedAdded.has(idx)) return
      const score = scoreLineSimilarity(removed.line, added.line)
      if (score > bestScore) {
        bestScore = score
        bestIdx = idx
      }
    })
    if (bestIdx >= 0 && bestScore >= 0.18) {
      usedAdded.add(bestIdx)
      pairs.push({ removed, added: addedOps[bestIdx] })
      return
    }
    pairs.push({ removed })
  })

  addedOps.forEach((added, idx) => {
    if (!usedAdded.has(idx)) pairs.push({ added })
  })

  return pairs
}

function computeLineDiff(before, after) {
  const a = splitLines(before)
  const b = splitLines(after)
  const aKey = a.map(normalizeLineForDiff)
  const bKey = b.map(normalizeLineForDiff)
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = aKey[i - 1] === bKey[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const reversed = []
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

function toLineCountMap(lines) {
  const map = new Map()
  lines.forEach(({ key }) => map.set(key, (map.get(key) || 0) + 1))
  return map
}

function consumeLine(map, key) {
  const count = map.get(key) || 0
  if (count <= 0) return false
  if (count === 1) map.delete(key)
  else map.set(key, count - 1)
  return true
}

function classifyAddedLine(key, hasAiSnapshot, aiAddedMap, manualAddedMap) {
  if (!hasAiSnapshot) return 'manual'
  if (consumeLine(manualAddedMap, key)) return 'manual'
  if (consumeLine(aiAddedMap, key)) return 'api'
  return 'manual'
}

function isWordIdenticalDiffBlock(removedOps, addedOps) {
  if (removedOps.length === 0 || addedOps.length === 0) return false
  const removedWords = normalizeTextForDiff(removedOps.map(op => op.line).join(' '))
  const addedWords = normalizeTextForDiff(addedOps.map(op => op.line).join(' '))
  return !!removedWords && removedWords === addedWords
}

function consumeAddedOpsFromClassifiers(addedOps, hasAiSnapshot, aiAddedMap, manualAddedMap) {
  if (!hasAiSnapshot) return
  addedOps.forEach((added) => {
    if (!added.key) return
    classifyAddedLine(added.key, hasAiSnapshot, aiAddedMap, manualAddedMap)
  })
}

function reconcileMovedUnchangedRows(rows, stats) {
  const nextRows = rows.map(row => ({ ...row }))
  const nextStats = { ...stats }
  const removedByKey = new Map()

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

    let bestPos = 0
    let bestDistance = Infinity
    candidates.forEach((candidateIdx, pos) => {
      const distance = Math.abs(candidateIdx - idx)
      if (distance < bestDistance) {
        bestDistance = distance
        bestPos = pos
      }
    })

    const [removedIdx] = candidates.splice(bestPos, 1)
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

function buildCompareRows(originalText, latestAiText, currentText) {
  if (!originalText.trim()) return { rows: [], stats: { api: 0, manual: 0, removed: 0, unchanged: 0 } }

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

  const rows = []
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

    const removedOps = []
    const addedOps = []
    while (idx < currentDiff.length && currentDiff[idx].type !== 'equal') {
      const diffOp = currentDiff[idx]
      if (diffOp.type === 'remove') removedOps.push({ line: diffOp.line, key: diffOp.key })
      if (diffOp.type === 'add') addedOps.push({ line: diffOp.line, key: diffOp.key })
      idx++
    }

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

      for (let i = removedOps.length; i < addedOps.length; i++) rightNum++
      continue
    }

    const pairs = pairDiffBlock(removedOps, addedOps)
    for (const pair of pairs) {
      const removed = pair.removed
      const added = pair.added
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
      const leftStatus = removed ? 'removed' : 'empty'
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

function mulberry32(seed) {
  let t = seed >>> 0
  return function rand() {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const WORD_SWAPS = new Map([
  ['led', 'drove'],
  ['developed', 'engineered'],
  ['improved', 'optimized'],
  ['managed', 'coordinated'],
  ['designed', 'architected'],
  ['analyzed', 'evaluated'],
  ['research', 'investigation'],
  ['project', 'program'],
  ['collaborated', 'partnered'],
  ['built', 'implemented'],
])

function mutateLine(line, rand) {
  let out = line
  if (!line.trim()) return out

  if (rand() < 0.35) {
    const words = line.split(/\s+/)
    const idx = Math.floor(rand() * words.length)
    const key = words[idx]?.toLowerCase().replace(/[^a-z]/g, '')
    if (key && WORD_SWAPS.has(key)) words[idx] = WORD_SWAPS.get(key)
    out = words.join(' ')
  }

  if (rand() < 0.2) out = out.replace(/\b(\d+)\b/, (_, n) => String(Number(n) + 1))
  if (rand() < 0.15) out = `${out} (${['ATS', 'GxP', 'SOP', 'FDA'][Math.floor(rand() * 4)]})`
  return out
}

function mutateResumeText(sourceText, rand, intensity = 0.08) {
  const lines = splitLines(sourceText)
  const out = []

  for (const line of lines) {
    if (line.trim() && rand() < intensity * 0.35) continue
    let next = line
    if (line.trim() && rand() < intensity) next = mutateLine(line, rand)
    out.push(next)
    if (line.trim() && rand() < intensity * 0.25) {
      out.push(`• ${['Matched role keywords', 'Tailored impact metrics', 'Refined action verbs'][Math.floor(rand() * 3)]}`)
    }
  }

  if (rand() < intensity * 2) {
    out.push('')
    out.push('SKILLS')
    out.push('• Cross-functional communication')
    out.push('• Scientific writing')
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function punctuationVariant(sourceText) {
  return sourceText
    .replace(/[,:;.!?]/g, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.docx' || ext === '.doc') {
    return execFileSync('textutil', ['-convert', 'txt', '-stdout', filePath], { encoding: 'utf8' })
  }
  return fs.readFileSync(filePath, 'utf8')
}

function validateCompareResult(baseText, latestAi, currentText, compare) {
  const counted = { api: 0, manual: 0, removed: 0, unchanged: 0 }
  compare.rows.forEach((row) => {
    if (row.leftStatus === 'removed') counted.removed++
    if (row.rightStatus === 'api') counted.api++
    if (row.rightStatus === 'manual') counted.manual++
    if (row.leftStatus === 'unchanged' && row.rightStatus === 'unchanged') counted.unchanged++
  })

  if (
    counted.api !== compare.stats.api
    || counted.manual !== compare.stats.manual
    || counted.removed !== compare.stats.removed
    || counted.unchanged !== compare.stats.unchanged
  ) {
    return 'Stats mismatch between row aggregation and summary.'
  }

  const changed = normalizeLineForDiff(baseText) !== normalizeLineForDiff(currentText)
  const hasAnyChange = compare.stats.api + compare.stats.manual + compare.stats.removed > 0
  if (changed && !hasAnyChange) {
    return 'Content changed but compare stats reported no changes.'
  }

  const emptyRows = compare.rows.filter(r => !r.leftLine && !r.rightLine)
  if (emptyRows.length > 0) return 'Encountered empty compare rows.'

  if (!latestAi.trim()) {
    const hasApiRows = compare.rows.some(r => r.rightStatus === 'api')
    if (hasApiRows) return 'No AI snapshot provided, but API-classified rows were produced.'
  }

  if (normalizeTextForDiff(baseText) === normalizeTextForDiff(currentText)) {
    if (compare.stats.api !== 0 || compare.stats.manual !== 0 || compare.stats.removed !== 0) {
      return 'Word-identical text should not emit API/manual/removed changes.'
    }
  }

  return null
}

function main() {
  const filePath = process.argv[2]
  const iterations = Number.parseInt(process.argv[3] || '20', 10)
  const seed = Number.parseInt(process.argv[4] || '17', 10)

  if (!filePath) {
    console.error('Usage: node scripts/resume-compare-harness.mjs <resume-file(.docx|.txt)> [iterations=20] [seed=17]')
    process.exit(1)
  }

  const baseText = extractTextFromFile(filePath)
  if (!baseText.trim()) {
    console.error('Base resume text is empty after extraction.')
    process.exit(1)
  }

  const rand = mulberry32(seed)
  const failures = []
  let aggregate = { api: 0, manual: 0, removed: 0, unchanged: 0 }

  for (let i = 1; i <= iterations; i++) {
    const aiDraft = mutateResumeText(baseText, rand, 0.08)
    const currentFromAi = mutateResumeText(aiDraft, rand, 0.07)
    const currentManualOnly = mutateResumeText(baseText, rand, 0.09)
    const punctuationOnly = punctuationVariant(baseText)

    const compareWithAi = buildCompareRows(baseText, aiDraft, currentFromAi)
    const compareManualOnly = buildCompareRows(baseText, '', currentManualOnly)
    const comparePunctuationOnly = buildCompareRows(baseText, punctuationOnly, punctuationOnly)

    const errA = validateCompareResult(baseText, aiDraft, currentFromAi, compareWithAi)
    const errB = validateCompareResult(baseText, '', currentManualOnly, compareManualOnly)
    const errC = validateCompareResult(baseText, punctuationOnly, punctuationOnly, comparePunctuationOnly)

    if (errA) failures.push(`Iteration ${i} (AI+manual): ${errA}`)
    if (errB) failures.push(`Iteration ${i} (manual-only): ${errB}`)
    if (errC) failures.push(`Iteration ${i} (punctuation-only): ${errC}`)

    aggregate.api += compareWithAi.stats.api
    aggregate.manual += compareWithAi.stats.manual + compareManualOnly.stats.manual + comparePunctuationOnly.stats.manual
    aggregate.removed += compareWithAi.stats.removed + compareManualOnly.stats.removed + comparePunctuationOnly.stats.removed
    aggregate.unchanged += compareWithAi.stats.unchanged + compareManualOnly.stats.unchanged + comparePunctuationOnly.stats.unchanged
  }

  console.log(`Base file: ${filePath}`)
  console.log(`Iterations: ${iterations} | Seed: ${seed}`)
  console.log(`Aggregate stats => API: ${aggregate.api}, Manual: ${aggregate.manual}, Removed: ${aggregate.removed}, Unchanged: ${aggregate.unchanged}`)

  if (failures.length > 0) {
    console.error(`Validation failures: ${failures.length}`)
    failures.slice(0, 12).forEach(f => console.error(`- ${f}`))
    process.exit(2)
  }

  console.log('All validation checks passed.')
}

main()
