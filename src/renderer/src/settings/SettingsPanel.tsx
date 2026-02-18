import React, { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Plus, Trash2, Folder, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { useToast } from '../shared/hooks/useToast'
import type { ResumeBase } from '@shared/types'
import clsx from 'clsx'

const KNOWN_MODELS = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'gpt-4o', 'gpt-4o-mini']

function ModelField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const filtered = KNOWN_MODELS.filter(m => m.toLowerCase().includes(value.toLowerCase()))
  return (
    <div className="relative">
      <label className="block text-xs font-medium text-text-muted mb-1">{label}</label>
      <input type="text" value={value} onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="input" placeholder="claude-sonnet-4-6" />
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 left-0 right-0 mt-1 bg-surface-2 border border-border rounded-md shadow-lg max-h-40 overflow-y-auto">
          {filtered.map(m => (
            <li key={m}><button onMouseDown={() => { onChange(m); setOpen(false) }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text font-mono">{m}</button></li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SecretField({ label, name, placeholder }: { label: string; name: string; placeholder?: string }) {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()
  useEffect(() => {
    window.api.getApiKey(name).then((v: unknown) => {
      const str = v as string
      setValue(str ? '••••••••••••••••' : '')
      setSaved(str || '')
      setLoading(false)
    })
  }, [name])
  async function handleSave() {
    const newVal = value.includes('•') ? saved : value
    await window.api.setApiKey(name, newVal)
    toast('success', `${label} saved`)
    setSaved(newVal)
    setValue('••••••••••••••••')
  }
  return (
    <div>
      <label className="block text-xs font-medium text-text-muted mb-1">{label}</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input type={show ? 'text' : 'password'} value={value} onChange={e => setValue(e.target.value)}
            placeholder={placeholder || 'Enter key...'} className="input pr-8" disabled={loading} />
          <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-text">
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button onClick={handleSave} className="btn-secondary flex-shrink-0">Save</button>
      </div>
    </div>
  )
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const [tab, setTab] = useState<'api' | 'email' | 'resume' | 'models' | 'storage' | 'interview'>('api')
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [resumeBases, setResumeBases] = useState<ResumeBase[]>([])
  const [editingBase, setEditingBase] = useState<Partial<ResumeBase> | null>(null)
  const [imapTestResult, setImapTestResult] = useState<{ success?: boolean; error?: string } | null>(null)
  const [imapTesting, setImapTesting] = useState(false)
  const [parsingResult, setParsingResult] = useState<unknown>(null)
  const [parsingLoading, setParsingLoading] = useState(false)

  useEffect(() => {
    window.api.getSettings().then((s: unknown) => setSettings(s as Record<string, unknown>))
    window.api.getResumeBases().then((b: unknown) => setResumeBases(b as ResumeBase[]))
  }, [])

  function updateSetting(key: string, value: unknown) {
    setSettings(prev => ({ ...prev, [key]: value }))
    window.api.setSettings({ [key]: value })
  }
  function updateModelSetting(key: string, value: string) {
    const models = { ...(settings.models as Record<string, string> || {}), [key]: value }
    updateSetting('models', models)
  }
  async function testImap() {
    setImapTesting(true); setImapTestResult(null)
    const result = await window.api.jobImapTest() as { success: boolean; error?: string }
    setImapTestResult(result); setImapTesting(false)
  }
  async function testParsing() {
    setParsingLoading(true)
    const result = await window.api.jobImapTestParsing() as unknown
    setParsingResult(result); setParsingLoading(false)
  }
  async function saveResumeBase() {
    if (!editingBase?.name || !editingBase?.content) return
    await window.api.saveResumeBase(editingBase as Record<string, unknown>)
    const bases = await window.api.getResumeBases() as ResumeBase[]
    setResumeBases(bases); setEditingBase(null)
    toast('success', 'Resume base saved')
  }
  async function deleteResumeBase(id: number) {
    await window.api.deleteResumeBase(id)
    setResumeBases(bases => bases.filter(b => b.id !== id))
    toast('success', 'Deleted')
  }

  const models = (settings.models as Record<string, string>) || {}
  const TABS = [{ id: 'api', label: 'API Keys' }, { id: 'email', label: 'Email / IMAP' }, { id: 'models', label: 'Models' }, { id: 'resume', label: 'Resume Bases' }, { id: 'storage', label: 'Storage' }, { id: 'interview', label: 'Interview Prep' }]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface rounded-xl border border-border w-[720px] max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-36 border-r border-border p-2 flex-shrink-0 overflow-y-auto">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
                className={clsx('w-full text-left px-3 py-2 rounded-md text-sm transition-colors mb-0.5', tab === t.id ? 'bg-accent/15 text-accent font-medium' : 'text-text-muted hover:text-text hover:bg-surface-2')}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {tab === 'api' && (
              <div className="space-y-4">
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">API Keys</h3>
                <p className="text-xs text-text-dim">Keys are encrypted at rest. Never transmitted externally.</p>
                <SecretField label="Anthropic Claude API Key" name="anthropicKey" placeholder="sk-ant-..." />
                <SecretField label="OpenAI API Key" name="openaiKey" placeholder="sk-..." />
                <SecretField label="PubMed / NCBI E-utilities API Key" name="pubmedKey" placeholder="Optional — increases rate limits" />
              </div>
            )}
            {tab === 'email' && (
              <div className="space-y-4">
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Job Alert Email (IMAP)</h3>
                <p className="text-xs text-text-dim">Use a Google App Password, not your regular password.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">IMAP Host</label>
                    <input value={(settings.imapHost as string) || ''} onChange={e => updateSetting('imapHost', e.target.value)} className="input" placeholder="imap.gmail.com" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Port</label>
                    <input type="number" value={(settings.imapPort as number) || 993} onChange={e => updateSetting('imapPort', parseInt(e.target.value))} className="input" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Email</label>
                    <input value={(settings.imapUser as string) || ''} onChange={e => updateSetting('imapUser', e.target.value)} className="input" placeholder="yourjobs@gmail.com" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">TLS</label>
                    <label className="flex items-center gap-2 mt-2 cursor-pointer">
                      <input type="checkbox" checked={(settings.imapTls as boolean) !== false} onChange={e => updateSetting('imapTls', e.target.checked)} className="accent-accent" />
                      <span className="text-sm text-text-muted">Use TLS</span>
                    </label>
                  </div>
                </div>
                <SecretField label="App Password" name="imapPass" placeholder="16-character Google App Password" />
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">LinkedIn Alert Forwarding Address</label>
                  <input value={(settings.imapForwardingAddress as string) || ''} onChange={e => updateSetting('imapForwardingAddress', e.target.value)} className="input" placeholder="alias@gmail.com" />
                  <p className="text-xs text-text-dim mt-1">Emails FROM this address will be processed. Secondary check via LinkedIn headers.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={testImap} disabled={imapTesting} className="btn-secondary">
                    {imapTesting ? <Loader2 size={14} className="animate-spin" /> : null} Test Connection
                  </button>
                  <button onClick={testParsing} disabled={parsingLoading} className="btn-secondary">
                    {parsingLoading ? <Loader2 size={14} className="animate-spin" /> : null} Test Parsing
                  </button>
                </div>
                {imapTestResult && (
                  <div className={clsx('flex items-center gap-2 p-3 rounded-lg text-sm', imapTestResult.success ? 'bg-success/10 text-success' : 'bg-error/10 text-error')}>
                    {imapTestResult.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                    {imapTestResult.success ? 'Connection successful' : imapTestResult.error}
                  </div>
                )}
                {!!parsingResult && (
                  <div className="bg-surface-2 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-text-muted">Last 5 emails:</p>
                    {((parsingResult as { emails: Array<{ from: string; subject: string; forwardedTo?: string; originalFrom?: string; replyTo?: string }> }).emails || []).map((e, i) => (
                      <div key={i} className="text-xs font-mono border border-border rounded p-2 space-y-1">
                        <div><span className="text-text-dim">From: </span>{e.from}</div>
                        <div><span className="text-text-dim">Subject: </span>{e.subject}</div>
                        {e.forwardedTo && <div><span className="text-text-dim">X-Forwarded-To: </span>{e.forwardedTo}</div>}
                        {e.originalFrom && <div><span className="text-text-dim">X-Original-From: </span>{e.originalFrom}</div>}
                        {e.replyTo && <div><span className="text-text-dim">Reply-To: </span>{e.replyTo}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {tab === 'models' && (
              <div className="space-y-4">
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Model Selection</h3>
                <p className="text-xs text-text-dim">Type any model ID or select from suggestions.</p>
                <ModelField label="Post Generator" value={models.postGenerator || ''} onChange={v => updateModelSetting('postGenerator', v)} />
                <ModelField label="Paper Discovery" value={models.paperDiscovery || ''} onChange={v => updateModelSetting('paperDiscovery', v)} />
                <ModelField label="Resume Generator" value={models.resumeGenerator || ''} onChange={v => updateModelSetting('resumeGenerator', v)} />
                <ModelField label="Cover Letter Generator" value={models.coverLetterGenerator || ''} onChange={v => updateModelSetting('coverLetterGenerator', v)} />
                <ModelField label="Q&A Generator" value={models.qaGenerator || ''} onChange={v => updateModelSetting('qaGenerator', v)} />
              </div>
            )}
            {tab === 'interview' && (
              <div className="space-y-4">
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Interview Prep</h3>
                <p className="text-xs text-text-dim">Settings for the Interview Prep module — research and mock interviews.</p>
                <ModelField
                  label="Research Model"
                  value={models.interviewResearch || ''}
                  onChange={v => updateModelSetting('interviewResearch', v)}
                />
                <p className="text-xs text-text-dim -mt-2">Use the most capable available model for best research quality. Defaults to claude-opus-4-6.</p>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Default Research Depth</label>
                  <select
                    value={(settings.interviewResearchDepth as string) || 'always_ask'}
                    onChange={e => updateSetting('interviewResearchDepth', e.target.value)}
                    className="input"
                  >
                    <option value="always_ask">Always ask</option>
                    <option value="quick">Quick Brief (pre-select)</option>
                    <option value="deep">Deep Research (pre-select)</option>
                  </select>
                  <p className="text-xs text-text-dim mt-1">When set to Quick or Deep, that option is pre-selected — you still click "Start Research" to begin.</p>
                </div>
              </div>
            )}
            {tab === 'resume' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Resume Bases</h3>
                  <button onClick={() => setEditingBase({ name: '', content: '', format: 'text' })} className="btn-primary text-xs"><Plus size={12} />New Base</button>
                </div>
                {resumeBases.map(base => (
                  <div key={base.id} className="card p-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{base.name}</div>
                      <div className="text-xs text-text-dim">{base.format} · {new Date(base.updatedAt).toLocaleDateString()}</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingBase(base)} className="btn-ghost text-xs">Edit</button>
                      <button onClick={() => deleteResumeBase(base.id)} className="btn-danger text-xs p-1"><Trash2 size={12} /></button>
                    </div>
                  </div>
                ))}
                {editingBase !== null && (
                  <div className="card p-4 space-y-3">
                    <h4 className="text-sm font-medium">{editingBase.id ? 'Edit' : 'New'} Resume Base</h4>
                    <input value={editingBase.name || ''} onChange={e => setEditingBase({ ...editingBase, name: e.target.value })} placeholder="Name (e.g., Research Track)" className="input" />
                    <textarea value={editingBase.content || ''} onChange={e => setEditingBase({ ...editingBase, content: e.target.value })} placeholder="Paste resume text here..." className="input resize-none" rows={10} />
                    <div className="flex gap-2">
                      <button onClick={saveResumeBase} className="btn-primary">Save</button>
                      <button onClick={() => setEditingBase(null)} className="btn-ghost">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {tab === 'storage' && (
              <div className="space-y-4">
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Storage</h3>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Output Folder</label>
                  <div className="flex gap-2">
                    <input value={(settings.outputFolder as string) || ''} readOnly className="input flex-1 cursor-default" />
                    <button onClick={async () => { const f = await window.api.openFolderPicker() as string | null; if (f) updateSetting('outputFolder', f) }} className="btn-secondary flex-shrink-0"><Folder size={14} />Browse</button>
                  </div>
                  <p className="text-xs text-text-dim mt-1">Where exported resumes and cover letters are saved</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Database Location</label>
                  <div className="flex gap-2">
                    <input value={(settings.dbPath as string) || 'Default (app data folder)'} readOnly className="input flex-1 cursor-default" />
                    <button onClick={async () => { const f = await window.api.openFolderPicker() as string | null; if (f) updateSetting('dbPath', f + '/dashboard.db') }} className="btn-secondary flex-shrink-0"><Folder size={14} />Browse</button>
                  </div>
                  <p className="text-xs text-text-dim mt-1">Point to iCloud Drive or Dropbox for sync. Restart required. Do not open on multiple machines simultaneously.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
