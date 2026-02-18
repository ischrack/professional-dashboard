import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'

interface Toast {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
  persistent?: boolean
}

interface ToastContextValue {
  toasts: Toast[]
  toast: (type: Toast['type'], message: string, persistent?: boolean) => void
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    clearTimeout(timers.current[id])
    delete timers.current[id]
  }, [])

  const toast = useCallback((type: Toast['type'], message: string, persistent = false) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev.slice(-2), { id, type, message, persistent }])
    if (!persistent && type !== 'error') {
      timers.current[id] = setTimeout(() => dismiss(id), 4000)
    }
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" style={{ maxWidth: 384 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast animate-in"
          style={{ animation: 'slideIn 0.2s ease' }}
        >
          {t.type === 'success' && <CheckCircle size={16} className="text-success flex-shrink-0" />}
          {t.type === 'error' && <AlertCircle size={16} className="text-error flex-shrink-0" />}
          {t.type === 'info' && <Info size={16} className="text-accent flex-shrink-0" />}
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-text-dim hover:text-text transition-colors ml-1 flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
