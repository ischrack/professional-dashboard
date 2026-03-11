import React, { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Plus, Trash2, Folder, CheckCircle, AlertCircle, Loader2, Globe, LogOut, Upload, RotateCcw, History, FlaskConical, Copy } from 'lucide-react'
import { useToast } from '../shared/hooks/useToast'
import type { ResumeBase, ResumeBaseVersion } from '@shared/types'
import clsx from 'clsx'

const ANTHROPIC_MODELS = [
  { id: 'claude-opus-4-5',           label: 'Most capable' },
  { id: 'claude-sonnet-4-5',         label: 'Recommended' },
  { id: 'claude-haiku-4-5-20251001', label: 'Fastest' },
]
const OPENAI_MODELS = [
  { id: 'gpt-4o',     label: 'Recommended' },
  { id: 'gpt-4o-mini', label: 'Fastest' },
  { id: 'o3-mini',   label: 'Best for code' },
  { id: 'o1',        label: 'Most capable' },
]
const ALL_CURATED_IDS = new Set([...ANTHROPIC_MODELS, ...OPENAI_MODELS].map(m => m.id))

function pickerProvider(model: string): 'anthropic' | 'openai' {
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  return 'anthropic'
}

function validateAnthropicKey(v: string): string | null {
  if (!v.startsWith('sk-ant-') || v.length < 40) return 'Anthropic keys start with sk-ant-'
  return null
}
function validateOpenAIKey(v: string): string | null {
  if (v.startsWith('sk-ant-')) return 'This looks like an Anthropic key — paste it in the Anthropic field above'
  if (!v.startsWith('sk-') || v.length < 40) return 'OpenAI keys start with sk-'
  return null
}
const RESUME_LAYOUT_OPTIONS = [
  { value: 'ats_standard', label: 'ATS Standard (Recommended)' },
  { value: 'ats_compact', label: 'ATS Compact' },
  { value: 'ats_detailed', label: 'ATS Detailed' },
]

type LinkedinProbeRow = {
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
  steps?: string[]
}

type LinkedinManualCapture = {
  jobId: number
  text: string
  chain: unknown[]
  selectors: string[]
  url: string
  error?: string
}

function ModelPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [keysLoaded, setKeysLoaded] = useState(false)
  const [hasAnthropic, setHasAnthropic] = useState(false)
  const [hasOpenAI, setHasOpenAI] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.getApiKey('anthropicKey') as Promise<string>,
      window.api.getApiKey('openaiKey') as Promise<string>,
    ]).then(([a, o]) => {
      setHasAnthropic(!!a)
      setHasOpenAI(!!o)
      setKeysLoaded(true)
    })
  }, [])

  // Provider is always derived from the saved model string — it is the source of truth.
  // Key availability only controls which options/toggle are shown, never the active tab.
  const provider: 'anthropic' | 'openai' =
    value ? pickerProvider(value) : (hasAnthropic ? 'anthropic' : 'openai')
  const curatedList = provider === 'openai' ? OPENAI_MODELS : ANTHROPIC_MODELS
  const isCustom = value !== '' && !ALL_CURATED_IDS.has(value)
  const selectValue = isCustom ? '__custom__' : value

  function switchProvider(p: 'anthropic' | 'openai') {
    const list = p === 'openai' ? OPENAI_MODELS : ANTHROPIC_MODELS
    onChange((list.find(m => m.label === 'Recommended') ?? list[0]).id)
  }

  if (!keysLoaded) {
    return (
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-text-muted">{label}</label>
        <div className="h-9 rounded-md bg-surface-2 animate-pulse" />
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-text-muted">{label}</label>
      {hasAnthropic && hasOpenAI && (
        <div className="flex gap-0.5 p-0.5 bg-surface-2 rounded-md w-fit">
          {(['anthropic', 'openai'] as const).map(p => (
            <button key={p} onClick={() => switchProvider(p)}
              className={clsx('px-2.5 py-0.5 text-xs rounded transition-colors',
                provider === p ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text')}>
              {p === 'anthropic' ? 'Anthropic' : 'OpenAI'}
            </button>
          ))}
        </div>
      )}
      <select value={selectValue} onChange={e => { if (e.target.value !== '__custom__') onChange(e.target.value) }}
        className="input">
        {curatedList.map(m => (
          <option key={m.id} value={m.id}>{m.id} — {m.label}</option>
        ))}
        <option value="__custom__">Custom model ID...</option>
      </select>
      {selectValue === '__custom__' && (
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          placeholder="Enter model ID" className="input font-mono text-xs" />
      )}
    </div>
  )
}

function SecretField({ label, name, inputName, placeholder, validate }: {
  label: string
  name: string
  inputName?: string
  placeholder?: string
  validate?: (v: string) => string | null
}) {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(true)
  const [readOnly, setReadOnly] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    window.api.getApiKey(name).then((v: unknown) => {
      const str = v as string
      setValue(str ? '••••••••••••••••' : '')
      setSaved(str || '')
      setLoading(false)
    })
  }, [name])

  function checkError(v: string): string | null {
    if (!validate || !v || v.includes('•')) return null
    return validate(v)
  }

  async function handleSave() {
    const err = checkError(value)
    if (err) { setError(err); return }
    const newVal = value.includes('•') ? saved : value
    await window.api.setApiKey(name, newVal)
    toast('success', `${label} saved`)
    setSaved(newVal)
    setValue('••••••••••••••••')
    setError(null)
  }

  return (
    <div>
      <label className="block text-xs font-medium text-text-muted mb-1">{label}</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            {...(inputName ? { name: inputName } : {})}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            readOnly={readOnly}
            onChange={e => { setValue(e.target.value); setError(null) }}
            onFocus={() => setReadOnly(false)}
            onBlur={() => setError(checkError(value))}
            placeholder={placeholder || 'Enter key...'}
            className={clsx('input pr-8', error && 'border-error focus:ring-error/30')}
            disabled={loading}
          />
          <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-text">
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button onClick={handleSave} disabled={error !== null} className="btn-secondary flex-shrink-0">Save</button>
      </div>
      {error && <p className="text-xs text-error mt-1">{error}</p>}
    </div>
  )
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const [tab, setTab] = useState<'api' | 'linkedin' | 'email' | 'resume' | 'models' | 'storage' | 'interview' | 'codeLearning'>('api')
  const [vsCodeConnected, setVsCodeConnected] = useState(false)
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [resumeBases, setResumeBases] = useState<ResumeBase[]>([])
  const [editingBase, setEditingBase] = useState<Partial<ResumeBase> | null>(null)
  const [baseVersions, setBaseVersions] = useState<ResumeBaseVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [importingBaseFile, setImportingBaseFile] = useState(false)
  const [restoringVersionId, setRestoringVersionId] = useState<number | null>(null)
  const [imapTestResult, setImapTestResult] = useState<{ success?: boolean; error?: string } | null>(null)
  const [imapTesting, setImapTesting] = useState(false)
  const [parsingResult, setParsingResult] = useState<unknown>(null)
  const [parsingLoading, setParsingLoading] = useState(false)
  const [linkedinProbeInput, setLinkedinProbeInput] = useState('')
  const [linkedinProbeRunning, setLinkedinProbeRunning] = useState(false)
  const [linkedinProbeResults, setLinkedinProbeResults] = useState<LinkedinProbeRow[]>([])
  const [linkedinManualCapture, setLinkedinManualCapture] = useState<LinkedinManualCapture | null>(null)

  useEffect(() => {
    window.api.getSettings().then((s: unknown) => setSettings(s as Record<string, unknown>))
    window.api.getResumeBases().then((b: unknown) => setResumeBases(b as ResumeBase[]))
  }, [])

  useEffect(() => {
    const unsub = window.api.onLinkedinManualEnrichResult((result) => {
      const r = result as LinkedinManualCapture
      if (r.jobId !== -1) return
      if (r.error) {
        toast('error', r.error)
        return
      }
      setLinkedinManualCapture(r)
      toast('success', 'Manual LinkedIn capture saved from browser selection')
    })
    return unsub
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
  async function runLinkedinProbe() {
    const urls = Array.from(new Set(
      linkedinProbeInput
        .split(/\n|,/)
        .map((u) => u.trim())
        .filter(Boolean)
    )).slice(0, 20)

    if (urls.length === 0) {
      toast('error', 'Paste at least one LinkedIn job URL first')
      return
    }

    setLinkedinProbeRunning(true)
    try {
      const rows = await window.api.linkedinProbeUrls(urls) as LinkedinProbeRow[]
      setLinkedinProbeResults(rows)
      const ok = rows.filter(r => r.success).length
      toast('success', `LinkedIn Scrape Lab complete: ${ok}/${rows.length} extracted`)
    } catch (err) {
      toast('error', String(err))
    } finally {
      setLinkedinProbeRunning(false)
    }
  }
  function copyLinkedinProbeReport() {
    if (linkedinProbeResults.length === 0) return
    const report = linkedinProbeResults.map((row, i) => {
      const steps = Array.isArray(row.steps) ? row.steps.join(' | ') : ''
      return [
        `#${i + 1} ${row.success ? 'SUCCESS' : 'FAIL'} — ${row.url}`,
        `method: ${row.method || 'n/a'}`,
        `authRequired: ${row.authRequired ? 'yes' : 'no'}`,
        `descriptionLength: ${row.descriptionLength ?? 0}`,
        `error: ${row.error || 'n/a'}`,
        `fetchFinalUrl: ${row.fetchFinalUrl || 'n/a'}`,
        `domFinalUrl: ${row.domFinalUrl || 'n/a'}`,
        `expandClicks: ${row.expandClicks ?? 0}`,
        `patternSelectorsTried: ${row.patternSelectorsTried ?? 0}`,
        `steps: ${steps || 'n/a'}`,
        row.descriptionPreview ? `preview:\n${row.descriptionPreview}` : '',
      ].filter(Boolean).join('\n')
    }).join('\n\n')
    navigator.clipboard.writeText(report)
    toast('success', 'Probe report copied')
  }
  async function openManualCaptureForProbe(url: string) {
    try {
      await window.api.linkedinOpenUrl(url)
      await new Promise(r => setTimeout(r, 500))
      await window.api.linkedinSetManualEnrich(-1)
      toast('success', 'Highlight About the job text in browser, then click Save Description')
    } catch (err) {
      toast('error', String(err))
    }
  }
  async function saveManualCapturePattern() {
    if (!linkedinManualCapture) return
    let urlPattern = ''
    try { urlPattern = new URL(linkedinManualCapture.url).hostname } catch { /* ignore */ }
    await window.api.patternSave({
      jobId: null,
      url: linkedinManualCapture.url,
      urlPattern,
      fieldType: 'description',
      selectedText: (linkedinManualCapture.text || '').slice(0, 500),
      chainJson: JSON.stringify(linkedinManualCapture.chain || []),
      selectorsJson: JSON.stringify(linkedinManualCapture.selectors || []),
      source: 'probe_manual',
    })
    toast('success', 'Saved manual capture pattern for future LinkedIn scraping')
  }
  async function saveResumeBase() {
    if (!editingBase?.name || !editingBase?.content) return
    const id = await window.api.saveResumeBase(editingBase as Record<string, unknown>) as number
    const bases = await window.api.getResumeBases() as ResumeBase[]
    setResumeBases(bases)
    const refreshed = bases.find(b => b.id === Number(id))
    setEditingBase(refreshed || null)
    if (refreshed) await loadResumeBaseVersions(refreshed.id)
    toast('success', 'Vault document saved')
  }
  async function deleteResumeBase(id: number) {
    await window.api.deleteResumeBase(id)
    setResumeBases(bases => bases.filter(b => b.id !== id))
    if (editingBase?.id === id) {
      setEditingBase(null)
      setBaseVersions([])
    }
    toast('success', 'Document deleted')
  }

  async function loadResumeBaseVersions(baseId: number) {
    setVersionsLoading(true)
    try {
      const versions = await window.api.getResumeBaseVersions(baseId) as ResumeBaseVersion[]
      setBaseVersions(versions)
    } finally {
      setVersionsLoading(false)
    }
  }

  async function startEditingBase(base: Partial<ResumeBase>) {
    const normalized: Partial<ResumeBase> = {
      ...base,
      docType: base.docType || 'resume',
      format: base.format || 'text',
      lockedSections: Array.isArray(base.lockedSections) && base.lockedSections.length > 0
        ? base.lockedSections
        : ['publications'],
    }
    setEditingBase(normalized)
    if (normalized.id) await loadResumeBaseVersions(normalized.id)
    else setBaseVersions([])
  }

  async function handleImportVaultFile() {
    if (!editingBase) return
    const filePath = await window.api.openFilePicker([
      { name: 'Resume/CV files', extensions: ['docx', 'doc', 'pdf', 'txt', 'md', 'rtf'] },
    ]) as string | null
    if (!filePath) return

    setImportingBaseFile(true)
    try {
      const parsed = await window.api.parseResumeFile(filePath) as {
        success?: boolean
        content?: string
        format?: 'docx' | 'pdf' | 'text'
        fileName?: string
        filePath?: string
        error?: string
      }
      if (!parsed.success || !parsed.content) {
        toast('error', parsed.error || 'Could not import file')
        return
      }
      setEditingBase(prev => prev ? {
        ...prev,
        content: parsed.content || '',
        format: parsed.format || 'text',
        sourceFileName: parsed.fileName,
        sourceFilePath: parsed.filePath || filePath,
      } : prev)
      toast('success', `Imported ${parsed.fileName || 'file'} (${parsed.content.length} chars)`)
    } catch (err) {
      toast('error', String(err))
    } finally {
      setImportingBaseFile(false)
    }
  }

  async function restoreVersion(versionId: number) {
    if (!editingBase?.id) return
    setRestoringVersionId(versionId)
    try {
      const ok = await window.api.restoreResumeBaseVersion(editingBase.id, versionId) as boolean
      if (!ok) {
        toast('error', 'Could not restore this version')
        return
      }
      const bases = await window.api.getResumeBases() as ResumeBase[]
      setResumeBases(bases)
      const refreshed = bases.find(b => b.id === editingBase.id)
      setEditingBase(refreshed || null)
      if (refreshed) await loadResumeBaseVersions(refreshed.id)
      toast('success', 'Version restored')
    } finally {
      setRestoringVersionId(null)
    }
  }

  const models = (settings.models as Record<string, string>) || {}
  const TABS = [{ id: 'api', label: 'API Keys' }, { id: 'linkedin', label: 'LinkedIn' }, { id: 'email', label: 'Email / IMAP' }, { id: 'models', label: 'Models' }, { id: 'resume', label: 'Resume/CV Vault' }, { id: 'storage', label: 'Storage' }, { id: 'interview', label: 'Interview Prep' }, { id: 'codeLearning', label: 'Code Learning' }]

  async function handleCheckVsCode() {
    const status = await window.api.getVsCodeStatus() as { connected: boolean }
    setVsCodeConnected(status.connected)
  }

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
                <SecretField label="Anthropic Claude API Key" name="anthropicKey" inputName="api-key-anthropic" placeholder="sk-ant-..." validate={validateAnthropicKey} />
                <SecretField label="OpenAI API Key" name="openaiKey" inputName="api-key-openai" placeholder="sk-..." validate={validateOpenAIKey} />
                <SecretField label="PubMed / NCBI E-utilities API Key" name="pubmedKey" inputName="api-key-pubmed" placeholder="Optional — increases rate limits" />
              </div>
            )}
            {tab === 'linkedin' && (
              <div className="space-y-4">
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">LinkedIn Authentication</h3>
                <p className="text-xs text-text-dim">
                  Sign in to LinkedIn in the embedded browser to enable job enrichment. Your session persists between app launches.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { window.api.showLinkedInBrowser(); onClose() }}
                    className="btn-primary text-xs"
                  >
                    <Globe size={13} />Open LinkedIn Browser
                  </button>
                  <button
                    onClick={() => window.api.linkedinLogout()}
                    className="btn-ghost text-xs text-error hover:text-error flex items-center gap-1.5"
                  >
                    <LogOut size={12} />Log Out
                  </button>
                </div>
                <div className="card p-4 space-y-2">
                  <p className="text-xs font-semibold text-text-muted mb-1">Setup steps</p>
                  <p className="text-xs text-text-dim">1. Click "Open LinkedIn Browser" above</p>
                  <p className="text-xs text-text-dim">2. Sign in to your LinkedIn account in the panel that opens</p>
                  <p className="text-xs text-text-dim">3. Click "Done" to close the panel — your session is saved</p>
                  <p className="text-xs text-text-dim">4. Select jobs in the list and click "Enrich" to fetch details</p>
                </div>

                <div className="card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                      <FlaskConical size={12} />LinkedIn Scrape Lab
                    </p>
                    {linkedinProbeResults.length > 0 && (
                      <button onClick={copyLinkedinProbeReport} className="btn-ghost text-xs p-1.5" title="Copy full report">
                        <Copy size={12} />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-text-dim">
                    Paste up to 20 LinkedIn job URLs to test extraction strategies directly (server fetch + DOM fallback + learned selector replay).
                  </p>
                  <textarea
                    value={linkedinProbeInput}
                    onChange={e => setLinkedinProbeInput(e.target.value)}
                    placeholder={'https://www.linkedin.com/jobs/view/...\nhttps://www.linkedin.com/jobs/view/...'}
                    rows={4}
                    className="input resize-none text-xs font-mono"
                  />
                  <div className="flex gap-2">
                    <button onClick={runLinkedinProbe} disabled={linkedinProbeRunning} className="btn-secondary text-xs">
                      {linkedinProbeRunning ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
                      Run Probe
                    </button>
                    <button onClick={() => { setLinkedinProbeInput(''); setLinkedinProbeResults([]) }} className="btn-ghost text-xs">
                      Clear
                    </button>
                  </div>

                  {linkedinManualCapture && (
                    <div className="border border-border rounded-lg p-2.5 space-y-2 bg-surface">
                      <p className="text-[10px] uppercase tracking-wider text-text-dim font-semibold">Latest Manual Capture</p>
                      <p className="text-[11px] text-text font-mono break-all">{linkedinManualCapture.url}</p>
                      <p className="text-[11px] text-text-dim">
                        text {linkedinManualCapture.text?.length || 0} chars · selectors {linkedinManualCapture.selectors?.length || 0}
                      </p>
                      <p className="text-[11px] text-text-muted bg-surface-2 rounded p-2 leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto">
                        {linkedinManualCapture.text?.slice(0, 900)}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => navigator.clipboard.writeText(linkedinManualCapture.text || '').then(() => toast('success', 'Manual text copied'))}
                          className="btn-ghost text-[11px] py-1"
                        >
                          Copy Text
                        </button>
                        <button onClick={saveManualCapturePattern} className="btn-ghost text-[11px] py-1">
                          Save Pattern
                        </button>
                        <button onClick={() => setLinkedinManualCapture(null)} className="btn-ghost text-[11px] py-1">
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}

                  {linkedinProbeResults.length > 0 && (
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {linkedinProbeResults.map((row, idx) => (
                        <div key={`${row.url}-${idx}`} className="border border-border rounded-lg p-2.5 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[11px] text-text font-mono break-all">{row.url}</p>
                            <span className={clsx('badge text-[10px] flex-shrink-0', row.success ? 'badge-success' : 'badge-gray')}>
                              {row.success ? 'OK' : 'FAIL'}
                            </span>
                          </div>
                          <p className="text-[11px] text-text-dim">
                            {row.method || 'n/a'} · len {row.descriptionLength ?? 0} · expand {row.expandClicks ?? 0} · patterns {row.patternSelectorsTried ?? 0}
                          </p>
                          {row.error && <p className="text-[11px] text-warning">{row.error}</p>}
                          {row.descriptionPreview && (
                            <p className="text-[11px] text-text-muted bg-surface-2 rounded p-2 leading-relaxed whitespace-pre-wrap">{row.descriptionPreview}</p>
                          )}
                          {Array.isArray(row.steps) && row.steps.length > 0 && (
                            <p className="text-[10px] text-text-dim font-mono break-words">{row.steps.join(' | ')}</p>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => { window.api.linkedinOpenUrl(row.url) }}
                              className="btn-ghost text-[11px] py-1"
                              title="Open this URL in embedded LinkedIn browser"
                            >
                              Open in Browser
                            </button>
                            <button
                              onClick={() => openManualCaptureForProbe(row.url)}
                              className="btn-ghost text-[11px] py-1"
                              title="Highlight About the job text and save selection from browser"
                            >
                              Manual Save
                            </button>
                            {row.descriptionPreview && (
                              <button
                                onClick={() => navigator.clipboard.writeText(row.descriptionPreview || '').then(() => toast('success', 'Preview copied'))}
                                className="btn-ghost text-[11px] py-1"
                                title="Copy extracted preview"
                              >
                                Copy Preview
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
                <p className="text-xs text-text-dim">Select a provider and model, or type a custom model ID.</p>
                <ModelPicker label="Post Generator" value={models.postGenerator || ''} onChange={v => updateModelSetting('postGenerator', v)} />
                <ModelPicker label="Paper Discovery" value={models.paperDiscovery || ''} onChange={v => updateModelSetting('paperDiscovery', v)} />
                <ModelPicker label="Resume Generator" value={models.resumeGenerator || ''} onChange={v => updateModelSetting('resumeGenerator', v)} />
                <ModelPicker label="Cover Letter Generator" value={models.coverLetterGenerator || ''} onChange={v => updateModelSetting('coverLetterGenerator', v)} />
                <ModelPicker label="Q&A Generator" value={models.qaGenerator || ''} onChange={v => updateModelSetting('qaGenerator', v)} />
                <ModelPicker label="Code Learning Coach" value={models.codeLearning || ''} onChange={v => updateModelSetting('codeLearning', v)} />
                <p className="text-xs text-text-dim -mt-2">Used for project proposals, curriculum generation, coaching chat, and code review. Defaults to claude-opus-4-6.</p>
              </div>
            )}
            {tab === 'interview' && (
              <div className="space-y-4">
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Interview Prep</h3>
                <p className="text-xs text-text-dim">Settings for the Interview Prep module — research and mock interviews.</p>
                <ModelPicker
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
                  <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Resume/CV Vault</h3>
                  <div className="flex gap-2">
                    <button onClick={() => startEditingBase({ name: '', content: '', format: 'text', docType: 'resume', lockedSections: ['publications'] })} className="btn-primary text-xs"><Plus size={12} />New Resume</button>
                    <button onClick={() => startEditingBase({ name: '', content: '', format: 'text', docType: 'cv', lockedSections: ['publications'] })} className="btn-secondary text-xs"><Plus size={12} />New CV</button>
                  </div>
                </div>
                {resumeBases.map(base => (
                  <div key={base.id} className="card p-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{base.name}</div>
                      <div className="text-xs text-text-dim flex items-center gap-2">
                        <span className="badge badge-gray text-[10px]">{(base.docType || 'resume').toUpperCase()}</span>
                        <span>{base.format} · v{base.activeVersion} · {new Date(base.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => startEditingBase(base)} className="btn-ghost text-xs">Edit</button>
                      <button onClick={() => deleteResumeBase(base.id)} className="btn-danger text-xs p-1"><Trash2 size={12} /></button>
                    </div>
                  </div>
                ))}
                {editingBase !== null && (
                  <div className="card p-4 space-y-3">
                    <h4 className="text-sm font-medium">{editingBase.id ? 'Edit' : 'New'} Vault Document</h4>
                    <input value={editingBase.name || ''} onChange={e => setEditingBase({ ...editingBase, name: e.target.value })} placeholder="Name (e.g., Research Track)" className="input" />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">Document Type</label>
                        <select
                          value={editingBase.docType || 'resume'}
                          onChange={e => setEditingBase({ ...editingBase, docType: (e.target.value as 'resume' | 'cv') })}
                          className="input"
                        >
                          <option value="resume">Resume</option>
                          <option value="cv">CV</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">Locked Sections</label>
                        <label className="flex items-center gap-2 mt-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(editingBase.lockedSections || ['publications']).includes('publications')}
                            onChange={(e) => {
                              const current = new Set(editingBase.lockedSections || [])
                              if (e.target.checked) current.add('publications')
                              else current.delete('publications')
                              setEditingBase({ ...editingBase, lockedSections: Array.from(current) })
                            }}
                            className="accent-accent"
                          />
                          <span className="text-sm text-text-muted">Publications (locked)</span>
                        </label>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={handleImportVaultFile} disabled={importingBaseFile} className="btn-secondary text-xs">
                        {importingBaseFile ? <Loader2 size={14} className="animate-spin" /> : <Upload size={12} />}
                        Import .docx/.pdf/.txt
                      </button>
                      {editingBase.sourceFileName && (
                        <span className="text-xs text-text-dim truncate">
                          Source: {editingBase.sourceFileName}
                        </span>
                      )}
                    </div>
                    <textarea value={editingBase.content || ''} onChange={e => setEditingBase({ ...editingBase, content: e.target.value })} placeholder="Paste resume/CV text here, or import a file..." className="input resize-none" rows={12} />
                    <div className="flex gap-2">
                      <button onClick={saveResumeBase} className="btn-primary">Save</button>
                      <button onClick={() => setEditingBase(null)} className="btn-ghost">Cancel</button>
                    </div>

                    {editingBase.id && (
                      <div className="pt-2 border-t border-border">
                        <div className="flex items-center gap-2 mb-2">
                          <History size={12} className="text-text-dim" />
                          <p className="text-xs font-semibold text-text-dim uppercase tracking-wider">Version History</p>
                        </div>
                        {versionsLoading ? (
                          <div className="flex items-center gap-2 text-xs text-text-dim">
                            <Loader2 size={12} className="animate-spin" /> Loading versions...
                          </div>
                        ) : baseVersions.length === 0 ? (
                          <p className="text-xs text-text-dim">No versions yet.</p>
                        ) : (
                          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                            {baseVersions.map(v => (
                              <div key={v.id} className="flex items-center justify-between bg-surface-2 rounded px-2 py-1.5">
                                <div className="min-w-0">
                                  <p className="text-xs text-text">
                                    v{v.versionNumber} · {v.format.toUpperCase()} · {new Date(v.createdAt).toLocaleString()}
                                  </p>
                                  {v.sourceFileName && (
                                    <p className="text-[10px] text-text-dim truncate">{v.sourceFileName}</p>
                                  )}
                                </div>
                                <button
                                  onClick={() => restoreVersion(v.id)}
                                  disabled={restoringVersionId === v.id}
                                  className="btn-ghost text-xs p-1.5"
                                  title="Restore this version"
                                >
                                  {restoringVersionId === v.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {tab === 'codeLearning' && (
              <div className="space-y-5">
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Code Learning</h3>

                {/* Default project folder */}
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Default Project Folder</label>
                  <div className="flex gap-2">
                    <input
                      value={(settings.codeLearningProjectFolder as string) || ''}
                      readOnly
                      className="input flex-1 cursor-default"
                      placeholder="~/Projects"
                    />
                    <button
                      onClick={async () => {
                        const f = await window.api.openFolderPicker() as string | null
                        if (f) updateSetting('codeLearningProjectFolder', f)
                      }}
                      className="btn-secondary flex-shrink-0"
                    >
                      <Folder size={14} />Browse
                    </button>
                  </div>
                  <p className="text-xs text-text-dim mt-1">Where new projects are scaffolded by default.</p>
                </div>

                {/* Review on save */}
                <div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(settings.codeLearningReviewOnSave as boolean) ?? false}
                        onChange={e => updateSetting('codeLearningReviewOnSave', e.target.checked)}
                        className="accent-accent"
                      />
                      <span className="text-sm text-text-muted">Review on save</span>
                    </label>
                    <span
                      className="text-[10px] text-text-dim border border-border rounded px-1.5 py-0.5 cursor-default"
                      title="This sends your file to the LLM on every save. Disable if you find it disruptive."
                    >
                      ?
                    </span>
                  </div>
                  <p className="text-xs text-text-dim mt-1">
                    Automatically sends the active file for LLM review on every save via the VS Code extension.{' '}
                    <span className="text-warning">Sends a request on every save — disable if disruptive.</span>
                  </p>
                </div>

                {/* Ollama endpoint */}
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Ollama Endpoint
                    <span className="ml-2 text-[10px] text-text-dim border border-border rounded px-1.5 py-0.5">Coming soon</span>
                  </label>
                  <input
                    value={(settings.codeLearningOllamaEndpoint as string) || ''}
                    disabled
                    className="input opacity-40 cursor-not-allowed"
                    placeholder="http://localhost:11434"
                  />
                  <p className="text-xs text-text-dim mt-1">Local Ollama support will be added in a future update.</p>
                </div>

                {/* VS Code extension status */}
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-2">VS Code Extension</label>
                  <div className="card p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', vsCodeConnected ? 'bg-success' : 'bg-text-dim')} />
                      <span className="text-sm text-text-muted">
                        {vsCodeConnected ? 'Extension connected' : 'Extension not connected'}
                      </span>
                      <button onClick={handleCheckVsCode} className="btn-ghost text-xs ml-auto">
                        Check
                      </button>
                    </div>
                    <div>
                      <p className="text-xs text-text-dim mb-2">
                        Build and install the extension locally:
                      </p>
                      <div className="bg-surface-2 rounded px-3 py-2 font-mono text-xs text-text-muted space-y-1">
                        <p>cd vscode-extension &amp;&amp; npm run compile &amp;&amp; npx vsce package</p>
                        <p>code --install-extension professional-dashboard-code-learning-0.1.0.vsix</p>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            'cd vscode-extension && npm run compile && npx vsce package && code --install-extension professional-dashboard-code-learning-0.1.0.vsix'
                          )
                          toast('success', 'Install command copied')
                        }}
                        className="btn-ghost text-xs mt-2"
                      >
                        <Copy size={12} />Copy install command
                      </button>
                    </div>
                  </div>
                </div>
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
                  <label className="block text-xs font-medium text-text-muted mb-1">Default Export Name Prefix</label>
                  <input
                    value={(settings.exportNamePrefix as string) || ''}
                    onChange={e => updateSetting('exportNamePrefix', e.target.value)}
                    className="input"
                    placeholder="Schrack_Ian"
                  />
                  <p className="text-xs text-text-dim mt-1">Used to build default file names in the export modal (editable there before saving).</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Default Resume Word Layout</label>
                  <select
                    value={(settings.resumeLayoutPreset as string) || 'ats_standard'}
                    onChange={e => updateSetting('resumeLayoutPreset', e.target.value)}
                    className="input"
                  >
                    {RESUME_LAYOUT_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-text-dim mt-1">Controls the default ATS-focused DOCX layout preset used in Resume exports.</p>
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
