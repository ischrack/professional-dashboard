import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface Section {
  level: 2 | 3
  title: string
  content: string
}

function parseMarkdownSections(markdown: string): { preamble: string; sections: Section[] } {
  const lines = markdown.split('\n')
  const sections: Section[] = []
  let preamble = ''
  let currentSection: Section | null = null
  let buffer: string[] = []

  for (const line of lines) {
    const h2 = line.match(/^## (.+)/)
    const h3 = line.match(/^### (.+)/)

    if (h2 || h3) {
      if (currentSection) {
        currentSection.content = buffer.join('\n').trim()
        sections.push(currentSection)
      } else if (buffer.length > 0) {
        preamble = buffer.join('\n').trim()
      }
      buffer = []
      currentSection = {
        level: h2 ? 2 : 3,
        title: (h2 || h3)![1].trim(),
        content: '',
      }
    } else {
      buffer.push(line)
    }
  }

  if (currentSection) {
    currentSection.content = buffer.join('\n').trim()
    sections.push(currentSection)
  } else if (!currentSection && buffer.length > 0) {
    preamble = buffer.join('\n').trim()
  }

  return { preamble, sections }
}

interface CollapsibleSectionProps {
  section: Section
  exportMode: boolean
}

function CollapsibleSection({ section, exportMode }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(false)
  const isOpen = exportMode || open

  return (
    <div className={`border border-border rounded-lg overflow-hidden ${section.level === 3 ? 'ml-4' : ''}`}>
      <button
        onClick={() => !exportMode && setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
          isOpen ? 'bg-surface-2' : 'hover:bg-surface-2'
        } ${exportMode ? 'cursor-default' : 'cursor-pointer'}`}
      >
        <span className={`font-semibold text-text ${section.level === 2 ? 'text-sm' : 'text-xs'}`}>
          {section.title}
        </span>
        {!exportMode && (
          isOpen ? <ChevronDown size={14} className="text-text-dim flex-shrink-0" /> : <ChevronRight size={14} className="text-text-dim flex-shrink-0" />
        )}
      </button>
      {isOpen && section.content && (
        <div className="px-4 pb-4 pt-2">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="text-sm text-text-muted leading-relaxed mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="list-disc list-outside ml-4 space-y-1 mb-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-outside ml-4 space-y-1 mb-2">{children}</ol>,
              li: ({ children }) => <li className="text-sm text-text-muted leading-relaxed">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
              a: ({ href, children }) => (
                <button
                  onClick={() => href && window.api.openExternal(href)}
                  className="text-accent hover:underline cursor-pointer"
                >
                  {children}
                </button>
              ),
              code: ({ children }) => <code className="bg-surface-3 px-1 rounded text-xs font-mono">{children}</code>,
              blockquote: ({ children }) => <blockquote className="border-l-2 border-accent/40 pl-3 italic text-text-dim my-2">{children}</blockquote>,
              h3: ({ children }) => <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mt-3 mb-1">{children}</h3>,
              h4: ({ children }) => <h4 className="text-xs font-semibold text-text mt-2 mb-1">{children}</h4>,
              table: ({ children }) => <div className="overflow-x-auto my-2"><table className="w-full text-xs border-collapse">{children}</table></div>,
              th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold bg-surface-2">{children}</th>,
              td: ({ children }) => <td className="border border-border px-2 py-1 text-text-muted">{children}</td>,
            }}
          >
            {section.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
}

interface CollapsibleMarkdownProps {
  content: string
  exportMode?: boolean
}

export default function CollapsibleMarkdown({ content, exportMode = false }: CollapsibleMarkdownProps) {
  const { preamble, sections } = parseMarkdownSections(content)

  return (
    <div className="space-y-2">
      {preamble && (
        <div className="px-1">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="text-sm text-text-muted leading-relaxed mb-2">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
            }}
          >
            {preamble}
          </ReactMarkdown>
        </div>
      )}
      {sections.map((section, i) => (
        <CollapsibleSection key={i} section={section} exportMode={exportMode} />
      ))}
    </div>
  )
}
