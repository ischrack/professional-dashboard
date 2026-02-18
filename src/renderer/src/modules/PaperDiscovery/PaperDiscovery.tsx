import React, { useState, useEffect } from 'react'
import {
  Search, RefreshCw, Plus, Star, BookOpen, ExternalLink, Send,
  ChevronDown, ChevronUp, Flame, TrendingUp, AlertTriangle,
  Loader2, FileText, Link, Settings2
} from 'lucide-react'
import clsx from 'clsx'
import { useToast } from '../../shared/hooks/useToast'
import type { Paper, SearchProfile } from '@shared/types'
import SearchProfileManager from './SearchProfileManager'

function TrendingBadge({ tier }: { tier?: string }) {
  if (tier === 'hot') return (
    <span className="badge bg-red-500/20 text-red-400 gap-1"><Flame size={10} />Hot</span>
  )
  if (tier === 'rising') return (
    <span className="badge bg-orange-500/20 text-orange-400 gap-1"><TrendingUp size={10} />Rising</span>
  )
  return null
}

function PaperCard({
  paper,
  onStar,
  onMarkRead,
  onSendToPost,
  onLinkPdf,
  onOpenPdf,
  onOpenBrowser,
}: {
  paper: Paper
  onStar: () => void
  onMarkRead: () => void
  onSendToPost: () => void
  onLinkPdf: () => void
  onOpenPdf: () => void
  onOpenBrowser: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [pdfBroken, setPdfBroken] = useState(false)

  useEffect(() => {
    if (paper.pdfPath) {
      window.api.paperCheckPdfPath(paper.pdfPath).then((ok: unknown) => {
        setPdfBroken(!(ok as boolean))
      })
    }
  }, [paper.pdfPath])

  return (
    <div className={clsx('card p-4 space-y-2', !paper.isRead && 'border-l-2 border-l-accent/50')}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <h3 className="text-sm font-medium text-text leading-snug">{paper.title}</h3>
            <TrendingBadge tier={paper.trendingTier} />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
            <span className="text-xs text-text-muted truncate max-w-xs">{paper.authors}</span>
            {paper.journal && (
              <span className="text-xs text-accent">{paper.journal}</span>
            )}
            {paper.year && <span className="text-xs text-text-dim">{paper.year}</span>}
            {paper.impactFactor && (
              <span className="badge badge-accent text-[10px]">IF {paper.impactFactor.toFixed(1)}</span>
            )}
          </div>
          {paper.profileNames?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {paper.profileNames.map(n => (
                <span key={n} className="badge badge-gray text-[10px]">{n}</span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onStar}
          className={clsx('flex-shrink-0 mt-0.5', paper.isStarred ? 'text-gold' : 'text-text-dim hover:text-gold')}
        >
          <Star size={14} fill={paper.isStarred ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Abstract */}
      {paper.abstract && (
        <div>
          <button
            onClick={() => { setExpanded(!expanded); if (!paper.isRead) onMarkRead() }}
            className="flex items-center gap-1 text-xs text-text-dim hover:text-text transition-colors"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? 'Hide abstract' : 'Show abstract'}
          </button>
          {expanded && (
            <p className="text-xs text-text-muted mt-2 leading-relaxed">{paper.abstract}</p>
          )}
        </div>
      )}

      {/* PDF path broken warning */}
      {paper.pdfPath && pdfBroken && (
        <div className="flex items-center gap-2 text-xs text-warning bg-warning/10 rounded px-2 py-1">
          <AlertTriangle size={12} />
          PDF path not found.
          <button onClick={onLinkPdf} className="underline hover:no-underline">Relink</button>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {paper.pdfPath && !pdfBroken ? (
          <button onClick={onOpenPdf} className="btn-ghost text-xs py-1">
            <FileText size={12} />Open PDF
          </button>
        ) : (
          <button onClick={onLinkPdf} className="btn-ghost text-xs py-1">
            <Link size={12} />{paper.pdfPath ? 'Relink PDF' : 'Link PDF'}
          </button>
        )}
        <button onClick={onOpenBrowser} className="btn-ghost text-xs py-1">
          <ExternalLink size={12} />Browser
        </button>
        <button onClick={onSendToPost} className="btn-ghost text-xs py-1">
          <Send size={12} />Post Generator
        </button>
      </div>
    </div>
  )
}

export default function PaperDiscovery() {
  const { toast } = useToast()
  const [papers, setPapers] = useState<Paper[]>([])
  const [profiles, setProfiles] = useState<SearchProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [profileManagerOpen, setProfileManagerOpen] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const [addingManual, setAddingManual] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [selectedProfiles, setSelectedProfiles] = useState<number[]>([])
  const [showUnread, setShowUnread] = useState(false)
  const [showStarred, setShowStarred] = useState(false)
  const [sortBy, setSortBy] = useState<'date' | 'trending'>('date')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const [p, pr] = await Promise.all([
      window.api.paperGetAll() as Promise<Paper[]>,
      window.api.paperGetProfiles() as Promise<SearchProfile[]>,
    ])
    setPapers(p)
    setProfiles(pr)
    setLoading(false)
  }

  async function handleFetchPubmed() {
    setFetching(true)
    try {
      const result = await window.api.paperFetchPubmed() as { added: number; error?: string }
      if (result.error) toast('error', result.error)
      else toast('success', `Fetched PubMed: ${result.added} new papers added`)
      await loadData()
    } catch (err) {
      toast('error', String(err))
    } finally {
      setFetching(false)
    }
  }

  async function handleAddManual() {
    if (!manualInput.trim()) return
    setAddingManual(true)
    try {
      const result = await window.api.paperAddManual(manualInput.trim()) as { id?: number; error?: string }
      if (result.error && result.error !== 'Paper already exists') {
        toast('error', result.error)
      } else {
        toast('success', result.error === 'Paper already exists' ? 'Paper already in library' : 'Paper added')
        setManualInput('')
        await loadData()
      }
    } catch (err) {
      toast('error', String(err))
    } finally {
      setAddingManual(false)
    }
  }

  async function handleStar(paper: Paper) {
    await window.api.paperUpdate(paper.id, { isStarred: !paper.isStarred ? 1 : 0 })
    setPapers(ps => ps.map(p => p.id === paper.id ? { ...p, isStarred: !p.isStarred } : p))
  }

  async function handleMarkRead(paper: Paper) {
    await window.api.paperUpdate(paper.id, { isRead: 1 })
    setPapers(ps => ps.map(p => p.id === paper.id ? { ...p, isRead: true } : p))
  }

  async function handleLinkPdf(paper: Paper) {
    const filePath = await window.api.openFilePicker([{ name: 'PDF', extensions: ['pdf'] }]) as string | null
    if (!filePath) return
    await window.api.paperLinkPdf(paper.id, filePath)
    setPapers(ps => ps.map(p => p.id === paper.id ? { ...p, pdfPath: filePath } : p))
    toast('success', 'PDF linked')
  }

  function handleOpenPdf(paper: Paper) {
    if (paper.pdfPath) window.api.openPath(paper.pdfPath)
  }

  function handleOpenBrowser(paper: Paper) {
    const url = paper.doi ? `https://doi.org/${paper.doi}` : paper.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}` : ''
    if (url) window.api.openExternal(url)
  }

  async function handleSendToPost(paper: Paper) {
    // Navigate to Post Generator — store selected paper in sessionStorage for handoff
    sessionStorage.setItem('postGeneratorPaper', JSON.stringify({
      url: paper.doi ? `https://doi.org/${paper.doi}` : paper.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}` : '',
      title: paper.title,
      authors: paper.authors,
      journal: paper.journal,
      abstract: paper.abstract,
    }))
    window.location.hash = '#/posts'
    toast('info', 'Opening Post Generator with this paper')
  }

  // Filter + sort
  const filtered = papers
    .filter(p => {
      if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !p.abstract.toLowerCase().includes(search.toLowerCase())) return false
      if (showUnread && p.isRead) return false
      if (showStarred && !p.isStarred) return false
      if (selectedProfiles.length > 0 && !selectedProfiles.some(id => p.profileIds?.includes(id))) return false
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'trending') {
        const tierScore = { hot: 3, rising: 2, normal: 1 }
        const aScore = tierScore[a.trendingTier as keyof typeof tierScore] || 0
        const bScore = tierScore[b.trendingTier as keyof typeof tierScore] || 0
        return bScore - aScore
      }
      return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
    })

  const unreadCount = papers.filter(p => !p.isRead).length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex-1">
          <h2 className="text-base font-semibold">Paper Discovery</h2>
          <p className="text-xs text-text-muted">{papers.length} papers · {unreadCount} unread</p>
        </div>
        <button onClick={() => setProfileManagerOpen(true)} className="btn-ghost text-xs gap-1">
          <Settings2 size={13} />
          Search Profiles
        </button>
        <button onClick={handleFetchPubmed} disabled={fetching} className="btn-secondary text-xs gap-1">
          {fetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Fetch PubMed
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-40">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search title, abstract..."
            className="input pl-8 py-1 text-xs"
          />
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setShowUnread(!showUnread)}
            className={clsx('btn text-xs py-1 px-2 rounded', showUnread ? 'btn-primary' : 'btn-secondary')}
          >
            Unread
          </button>
          <button
            onClick={() => setShowStarred(!showStarred)}
            className={clsx('btn text-xs py-1 px-2 rounded', showStarred ? 'btn-primary' : 'btn-secondary')}
          >
            Starred
          </button>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as 'date' | 'trending')}
            className="input text-xs py-1 w-auto"
          >
            <option value="date">Sort: Newest</option>
            <option value="trending">Sort: Trending</option>
          </select>
        </div>

        {/* Profile filter chips */}
        {profiles.map(p => (
          <button
            key={p.id}
            onClick={() => setSelectedProfiles(sel =>
              sel.includes(p.id) ? sel.filter(id => id !== p.id) : [...sel, p.id]
            )}
            className={clsx('badge text-xs cursor-pointer', selectedProfiles.includes(p.id) ? 'badge-accent' : 'badge-gray')}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Manual add */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0">
        <input
          value={manualInput}
          onChange={e => setManualInput(e.target.value)}
          placeholder="Add by DOI (10.xxx/xxx) or PubMed ID..."
          className="input text-xs py-1 flex-1"
          onKeyDown={e => e.key === 'Enter' && handleAddManual()}
        />
        <button onClick={handleAddManual} disabled={addingManual || !manualInput} className="btn-secondary text-xs py-1">
          {addingManual ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Add
        </button>
      </div>

      {/* Papers list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={20} className="animate-spin text-accent" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-text-dim">
            <BookOpen size={32} className="mb-3 opacity-30" />
            <p className="text-sm">No papers found</p>
            <p className="text-xs mt-1">Configure search profiles and click Fetch PubMed</p>
          </div>
        )}
        <div className="p-4 space-y-3">
          {filtered.map(paper => (
            <PaperCard
              key={paper.id}
              paper={paper}
              onStar={() => handleStar(paper)}
              onMarkRead={() => handleMarkRead(paper)}
              onSendToPost={() => handleSendToPost(paper)}
              onLinkPdf={() => handleLinkPdf(paper)}
              onOpenPdf={() => handleOpenPdf(paper)}
              onOpenBrowser={() => handleOpenBrowser(paper)}
            />
          ))}
        </div>
      </div>

      {profileManagerOpen && (
        <SearchProfileManager
          profiles={profiles}
          onClose={() => setProfileManagerOpen(false)}
          onSaved={async () => {
            const pr = await window.api.paperGetProfiles() as SearchProfile[]
            setProfiles(pr)
          }}
        />
      )}
    </div>
  )
}
