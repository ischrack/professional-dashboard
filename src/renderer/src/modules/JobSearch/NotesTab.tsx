import React, { useState, useEffect, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { CheckCircle } from 'lucide-react'

interface Props {
  jobId: number
}

export default function NotesTab({ jobId }: Props) {
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState(true)
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    window.api.jobGetNotes(jobId).then((c: unknown) => {
      setContent(c as string || '')
    })
  }, [jobId])

  const handleChange = useCallback((value: string) => {
    setContent(value)
    setSaved(false)
    clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      await window.api.jobSaveNotes(jobId, value)
      setSaved(true)
    }, 800)
  }, [jobId])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border flex-shrink-0">
        <span className="text-xs text-text-dim">Markdown notes — auto-saved</span>
        {saved && content && (
          <span className="text-xs text-success flex items-center gap-1">
            <CheckCircle size={11} />Saved
          </span>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        <CodeMirror
          value={content}
          onChange={handleChange}
          extensions={[markdown()]}
          theme={oneDark}
          style={{ height: '100%', fontSize: '13px' }}
          placeholder="Add notes about this job..."
        />
      </div>
    </div>
  )
}
