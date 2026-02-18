import React, { useState } from 'react'
import { X, Plus, Trash2, Save } from 'lucide-react'
import type { SearchProfile } from '@shared/types'
import { useToast } from '../../shared/hooks/useToast'
import clsx from 'clsx'

interface Props {
  profiles: SearchProfile[]
  onClose: () => void
  onSaved: () => Promise<void>
}

function TagInput({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('')

  function add() {
    const v = input.trim()
    if (v && !values.includes(v)) {
      onChange([...values, v])
    }
    setInput('')
  }

  return (
    <div>
      <label className="block text-xs font-medium text-text-muted mb-1">{label}</label>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {values.map(v => (
          <span key={v} className="badge badge-accent gap-1 text-xs">
            {v}
            <button onClick={() => onChange(values.filter(x => x !== v))} className="hover:text-error">
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={`Add ${label.toLowerCase()}...`}
          className="input text-xs py-1 flex-1"
        />
        <button onClick={add} disabled={!input.trim()} className="btn-secondary text-xs py-1">
          <Plus size={12} />
        </button>
      </div>
    </div>
  )
}

export default function SearchProfileManager({ profiles, onClose, onSaved }: Props) {
  const { toast } = useToast()
  const [editing, setEditing] = useState<Partial<SearchProfile> | null>(null)
  const [localProfiles, setLocalProfiles] = useState(profiles)

  async function handleSave() {
    if (!editing?.name) return
    await window.api.paperSaveProfile(editing as Record<string, unknown>)
    await onSaved()
    const updated = await window.api.paperGetProfiles() as SearchProfile[]
    setLocalProfiles(updated)
    setEditing(null)
    toast('success', 'Profile saved')
  }

  async function handleDelete(id: number) {
    await window.api.paperDeleteProfile(id)
    await onSaved()
    setLocalProfiles(ps => ps.filter(p => p.id !== id))
    toast('success', 'Profile deleted')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface rounded-xl border border-border w-[680px] max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-sm font-semibold">Search Profiles</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing({ name: '', keywords: [], meshTerms: [], authors: [], journals: [] })}
              className="btn-primary text-xs"
            >
              <Plus size={12} />New Profile
            </button>
            <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Profile list */}
          <div className="w-44 border-r border-border overflow-y-auto p-2 flex-shrink-0">
            {localProfiles.length === 0 && (
              <p className="text-xs text-text-dim p-2">No profiles yet</p>
            )}
            {localProfiles.map(p => (
              <div
                key={p.id}
                onClick={() => setEditing({ ...p })}
                className={clsx(
                  'flex items-center justify-between px-2 py-2 rounded cursor-pointer group',
                  editing?.id === p.id ? 'bg-accent/15 text-accent' : 'hover:bg-surface-2 text-text-muted'
                )}
              >
                <span className="text-xs truncate">{p.name}</span>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(p.id) }}
                  className="hidden group-hover:block text-text-dim hover:text-error"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>

          {/* Editor */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {!editing && (
              <p className="text-sm text-text-dim mt-8 text-center">Select or create a profile</p>
            )}
            {editing && (
              <>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Profile Name</label>
                  <input
                    value={editing.name || ''}
                    onChange={e => setEditing({ ...editing, name: e.target.value })}
                    placeholder="e.g., Macrophage Polarization"
                    className="input"
                  />
                </div>
                <TagInput
                  label="Keywords"
                  values={editing.keywords || []}
                  onChange={v => setEditing({ ...editing, keywords: v })}
                />
                <TagInput
                  label="MeSH Terms"
                  values={editing.meshTerms || []}
                  onChange={v => setEditing({ ...editing, meshTerms: v })}
                />
                <TagInput
                  label="Authors"
                  values={editing.authors || []}
                  onChange={v => setEditing({ ...editing, authors: v })}
                />
                <TagInput
                  label="Journals"
                  values={editing.journals || []}
                  onChange={v => setEditing({ ...editing, journals: v })}
                />
                <div className="flex gap-2 pt-2">
                  <button onClick={handleSave} className="btn-primary">
                    <Save size={14} />Save Profile
                  </button>
                  <button onClick={() => setEditing(null)} className="btn-ghost">Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
