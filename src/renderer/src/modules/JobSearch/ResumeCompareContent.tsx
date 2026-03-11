import React from 'react'
import type {
  ResumeCompareAnnotatedRow,
  ResumeCompareRowSideStatus,
  ResumeCompareWindowPayload,
  ResumeCompareWordToken,
} from '@shared/types'

function renderWordTokens(tokens: ResumeCompareWordToken[], changedClass: string) {
  if (!tokens.length) return <span> </span>
  return tokens.map((token, index) => (
    <React.Fragment key={`${index}:${token.text}`}>
      {index > 0 && ' '}
      <span className={token.changed ? changedClass : ''}>{token.text}</span>
    </React.Fragment>
  ))
}

function normalizeTokenKey(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  return normalized || value.toLowerCase()
}

function renderInlineWordDiff(
  baseTokens: ResumeCompareWordToken[],
  insertedTokens: ResumeCompareWordToken[],
  insertedClass: string
) {
  const removedClass = 'bg-error/25 text-error rounded px-0.5 line-through'
  const merged: Array<{ text: string; className: string }> = []
  let leftIdx = 0
  let rightIdx = 0

  while (leftIdx < baseTokens.length || rightIdx < insertedTokens.length) {
    const left = baseTokens[leftIdx]
    const right = insertedTokens[rightIdx]
    const leftUnchanged = !!left && !left.changed
    const rightUnchanged = !!right && !right.changed

    if (leftUnchanged && rightUnchanged) {
      const leftKey = normalizeTokenKey(left.text)
      const rightKey = normalizeTokenKey(right.text)
      if (leftKey === rightKey) {
        merged.push({ text: right.text, className: '' })
        leftIdx++
        rightIdx++
        continue
      }
    }

    if (left?.changed) {
      merged.push({ text: left.text, className: removedClass })
      leftIdx++
      continue
    }

    if (right?.changed) {
      merged.push({ text: right.text, className: insertedClass })
      rightIdx++
      continue
    }

    if (leftUnchanged && !right) {
      merged.push({ text: left.text, className: '' })
      leftIdx++
      continue
    }

    if (rightUnchanged && !left) {
      merged.push({ text: right.text, className: '' })
      rightIdx++
      continue
    }

    if (left && right) {
      merged.push({ text: right.text, className: '' })
      leftIdx++
      rightIdx++
      continue
    }

    break
  }

  if (!merged.length) return <span> </span>

  return merged.map((token, index) => (
    <React.Fragment key={`${index}:${token.text}:${token.className || 'unchanged'}`}>
      {index > 0 && ' '}
      <span className={token.className}>{token.text}</span>
    </React.Fragment>
  ))
}

function getInsertedWordClass(status: ResumeCompareRowSideStatus): string {
  if (status === 'api') return 'bg-success/25 text-success rounded px-0.5'
  if (status === 'manual') return 'bg-accent/25 text-accent rounded px-0.5'
  return 'bg-surface-2 text-text rounded px-0.5'
}

interface Props {
  payload: ResumeCompareWindowPayload
  showChanges?: boolean
}

function tokensToPlainText(tokens: ResumeCompareWordToken[]): string {
  return tokens.map(token => token.text).join(' ').trim()
}

function isLikelyJobHistoryStart(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (/^([•●▪◦*-]|\d+[.)])\s+/.test(t)) return false
  if (t.length < 12) return false
  if (/[A-Z][a-z]+,\s*[A-Z]{2}\b/.test(t)) return true
  if (
    /,/.test(t)
    && /\b(university|institute|laboratory|hospital|department|college|school|center|therapeutics|biomedical|engineering|research)\b/i.test(t)
  ) return true
  return false
}

function shouldAddEntrySpacing(
  row: ResumeCompareAnnotatedRow,
  prevRow: ResumeCompareAnnotatedRow | undefined,
  showChanges: boolean
): boolean {
  if (!prevRow) return false
  if (row.kind === 'heading' || row.kind === 'name' || row.kind === 'contact') return false
  if (prevRow.kind === 'heading' || prevRow.kind === 'name' || prevRow.kind === 'contact') return false

  const currentText = showChanges || !row.insertionOnly
    ? tokensToPlainText(row.baseTokens.length > 0 ? row.baseTokens : row.insertedTokens)
    : ''
  return isLikelyJobHistoryStart(currentText)
}

function renderResumeRow(row: ResumeCompareAnnotatedRow, showChanges: boolean, className: string) {
  const insertedClass = getInsertedWordClass(row.insertedStatus)
  const baseText = tokensToPlainText(row.baseTokens)
  const insertedText = tokensToPlainText(row.insertedTokens)

  if (!showChanges) {
    if (row.insertionOnly) return null
    if (row.kind === 'name') return <h1 key={row.key} className={className}>{baseText}</h1>
    if (row.kind === 'contact') return <h3 key={row.key} className={className}>{baseText}</h3>
    if (row.kind === 'heading') return <h2 key={row.key} className={className}>{baseText}</h2>
    if (row.kind === 'bullet') {
      return (
        <p key={row.key} className={`pl-5 -indent-4 ${className}`}>
          <span className="mr-2 text-text-dim">•</span>
          {baseText}
        </p>
      )
    }
    return <p key={row.key} className={className}>{baseText}</p>
  }

  const lineContent = row.insertionOnly
    ? (
      <>
        <span className="text-text-dim mr-1">+</span>
        {renderWordTokens(row.insertedTokens, insertedClass)}
      </>
    )
    : (
      <>
        {row.insertedTokens.length > 0
          ? renderInlineWordDiff(row.baseTokens, row.insertedTokens, insertedClass)
          : renderWordTokens(row.baseTokens, 'bg-error/25 text-error rounded px-0.5 line-through')}
      </>
    )

  if (row.kind === 'name') return <h1 key={row.key} className={className}>{lineContent}</h1>
  if (row.kind === 'contact') return <h3 key={row.key} className={className}>{lineContent}</h3>
  if (row.kind === 'heading') return <h2 key={row.key} className={className}>{lineContent}</h2>
  if (row.kind === 'bullet') {
    return (
      <p key={row.key} className={`pl-5 -indent-4 ${className}`}>
        <span className="mr-2 text-text-dim">•</span>
        {lineContent}
      </p>
    )
  }
  return <p key={row.key} className={className}>{lineContent || insertedText}</p>
}

export default function ResumeCompareContent({ payload, showChanges = true }: Props) {
  const visibleRows = showChanges ? payload.rows : payload.rows.filter(row => !row.insertionOnly)

  return (
    <div className="h-full flex-1 overflow-y-auto">
      {!payload.hasBaseContent ? (
        <div className="h-full flex items-center justify-center p-6 text-center">
          <p className="text-sm text-text-dim">Select a base resume to compare changes.</p>
        </div>
      ) : !payload.hasCompareRows || visibleRows.length === 0 ? (
        <div className="h-full flex items-center justify-center p-6 text-center">
          <p className="text-sm text-text-dim">Generate or load a resume draft to compare against your base resume.</p>
        </div>
      ) : (
        <div className="tiptap-editor">
          <div className="ProseMirror material-resume compare-base-readonly">
            {visibleRows.map((row, index) => {
              const prev = index > 0 ? visibleRows[index - 1] : undefined
              const spacingClass = shouldAddEntrySpacing(row, prev, showChanges) ? 'mt-3' : ''
              return renderResumeRow(row, showChanges, spacingClass)
            })}
          </div>
        </div>
      )}
    </div>
  )
}
