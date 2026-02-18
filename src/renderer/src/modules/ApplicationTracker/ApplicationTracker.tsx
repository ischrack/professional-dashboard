import React, { useState, useEffect } from 'react'
import { BarChart2, Table2, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { useToast } from '../../shared/hooks/useToast'
import type { TrackerEntry } from '@shared/types'
import { STATUS_CONFIG, TRACKER_STATUSES } from '../../shared/utils/statusConfig'
import AnalyticsDashboard from './AnalyticsDashboard'

type SortField = 'company' | 'title' | 'appliedAt' | 'status' | 'salary' | 'lastUpdated'

export default function ApplicationTracker() {
  const { toast } = useToast()
  const [view, setView] = useState<'table' | 'analytics'>('table')
  const [entries, setEntries] = useState<TrackerEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [sortField, setSortField] = useState<SortField>('appliedAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const data = await window.api.trackerGetAll() as TrackerEntry[]
    setEntries(data)
    setLoading(false)
  }

  async function handleStatusChange(jobId: number, status: string) {
    await window.api.trackerUpdateStatus(jobId, status)
    setEntries(prev => prev.map(e => e.id === jobId ? { ...e, status: status as TrackerEntry['status'], lastUpdated: new Date().toISOString() } : e))
  }

  async function handleDelete(jobId: number) {
    await window.api.trackerDelete(jobId)
    setEntries(prev => prev.filter(e => e.id !== jobId))
    setDeleteConfirm(null)
    toast('success', 'Entry deleted')
  }

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
  }

  const filtered = entries
    .filter(e => filterStatus === 'all' || e.status === filterStatus)
    .sort((a, b) => {
      let va = a[sortField] || ''
      let vb = b[sortField] || ''
      const cmp = String(va).localeCompare(String(vb))
      return sortDir === 'asc' ? cmp : -cmp
    })

  const colClass = 'px-3 py-2 text-xs'
  const headClass = 'px-3 py-2 text-[10px] font-semibold text-text-dim uppercase tracking-wider cursor-pointer hover:text-text select-none'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex-1">
          <h2 className="text-base font-semibold">Application Tracker</h2>
          <p className="text-xs text-text-muted">{entries.length} applications tracked</p>
        </div>

        {/* View toggle */}
        <div className="flex bg-surface-2 rounded-lg p-0.5">
          <button
            onClick={() => setView('table')}
            className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors', view === 'table' ? 'bg-surface-3 text-text' : 'text-text-muted hover:text-text')}
          >
            <Table2 size={13} />Table
          </button>
          <button
            onClick={() => setView('analytics')}
            className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors', view === 'analytics' ? 'bg-surface-3 text-text' : 'text-text-muted hover:text-text')}
          >
            <BarChart2 size={13} />Analytics
          </button>
        </div>
      </div>

      {view === 'analytics' ? (
        <AnalyticsDashboard entries={entries} />
      ) : (
        <>
          {/* Filter bar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0 flex-wrap">
            <span className="text-xs text-text-dim">Filter:</span>
            <button
              onClick={() => setFilterStatus('all')}
              className={clsx('badge text-xs cursor-pointer', filterStatus === 'all' ? 'badge-accent' : 'badge-gray')}
            >
              All ({entries.length})
            </button>
            {TRACKER_STATUSES.map(s => {
              const count = entries.filter(e => e.status === s).length
              if (!count) return null
              return (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={clsx('badge text-xs cursor-pointer', filterStatus === s ? 'badge-accent' : 'badge-gray')}
                >
                  {STATUS_CONFIG[s].label} ({count})
                </button>
              )
            })}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-surface border-b border-border z-10">
                <tr>
                  {([
                    { field: 'company', label: 'Company' },
                    { field: 'title', label: 'Role' },
                    { field: null, label: 'Location' },
                    { field: null, label: 'Remote' },
                    { field: 'salary', label: 'Salary' },
                    { field: 'appliedAt', label: 'Applied' },
                    { field: null, label: 'Source' },
                    { field: 'status', label: 'Status' },
                    { field: 'lastUpdated', label: 'Updated' },
                    { field: null, label: '' },
                  ] as Array<{ field: SortField | null; label: string }>).map(({ field, label }) => (
                    <th
                      key={label}
                      className={headClass}
                      onClick={() => field && toggleSort(field)}
                    >
                      <span className="flex items-center gap-1">
                        {label}
                        {field && <SortIcon field={field} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-center py-12 text-xs text-text-dim">
                      {loading ? 'Loading...' : 'No applications tracked yet. Mark jobs as Applied in the Job Search module.'}
                    </td>
                  </tr>
                )}
                {filtered.map(entry => {
                  const cfg = STATUS_CONFIG[entry.status]
                  return (
                    <tr
                      key={entry.id}
                      className="border-b border-border/50 hover:bg-surface-2 transition-colors group"
                      onKeyDown={e => e.key === 'Delete' && setDeleteConfirm(entry.id)}
                      tabIndex={0}
                    >
                      <td className={clsx(colClass, 'font-medium text-text')}>{entry.company}</td>
                      <td className={clsx(colClass, 'text-text-muted max-w-48 truncate')}>{entry.title}</td>
                      <td className={clsx(colClass, 'text-text-dim')}>{entry.location || '—'}</td>
                      <td className={clsx(colClass, 'text-text-dim')}>
                        {entry.remote ? <span className="badge badge-gray text-[10px]">{entry.remote}</span> : '—'}
                      </td>
                      <td className={clsx(colClass, 'text-text-dim')}>{entry.salary || '—'}</td>
                      <td className={clsx(colClass, 'text-text-dim whitespace-nowrap')}>
                        {entry.appliedAt ? new Date(entry.appliedAt).toLocaleDateString() : '—'}
                      </td>
                      <td className={clsx(colClass, 'text-text-dim')}>{entry.source || '—'}</td>
                      <td className={colClass}>
                        <select
                          value={entry.status}
                          onChange={e => handleStatusChange(entry.id, e.target.value)}
                          className="input text-xs py-0.5 w-auto"
                          style={{ color: cfg.color }}
                          onClick={e => e.stopPropagation()}
                        >
                          {TRACKER_STATUSES.map(s => (
                            <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                          ))}
                        </select>
                      </td>
                      <td className={clsx(colClass, 'text-text-dim whitespace-nowrap')}>
                        {entry.lastUpdated ? new Date(entry.lastUpdated).toLocaleDateString() : '—'}
                      </td>
                      <td className={colClass}>
                        <button
                          onClick={() => setDeleteConfirm(entry.id)}
                          className="opacity-0 group-hover:opacity-100 btn-ghost p-1 hover:text-error transition-opacity"
                          title="Delete (permanent)"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="card p-5 w-80 space-y-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-error">Permanently delete this entry?</h3>
            <p className="text-xs text-text-muted">This will remove all associated materials, Q&A, and notes. This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => handleDelete(deleteConfirm)} className="btn-danger flex-1 justify-center">Delete Permanently</button>
              <button onClick={() => setDeleteConfirm(null)} className="btn-ghost">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
