import { useCallback, useEffect, useRef, useState } from 'react'
import { Orbit as OrbitIcon, Search, Activity } from 'lucide-react'
import { api, type GlobalStats, type ProjectRollup, type SearchHit, type SessionSummary } from './api.ts'
import { fmtCost, fmtTokens } from './format.ts'
import Sidebar from './components/Sidebar.tsx'
import Overview from './components/Overview.tsx'
import SessionView from './components/SessionView.tsx'
import SearchPalette from './components/SearchPalette.tsx'

export default function App() {
  const [projects, setProjects] = useState<ProjectRollup[]>([])
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [projectId, setProjectId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [searchQ, setSearchQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [focusSeq, setFocusSeq] = useState<number | null>(null)
  const selectedRef = useRef<string | null>(null)
  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])

  const refresh = useCallback(async () => {
    try {
      const [p, s, sess] = await Promise.all([
        api.projects(),
        api.stats(),
        api.sessions(projectId, searchQ === '' ? undefined : searchQ),
      ])
      setProjects(p)
      setStats(s)
      setSessions(sess.sessions)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [projectId, searchQ])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Poll every 5s so live indicators stay fresh (SSE lands in P2).
  useEffect(() => {
    const t = setInterval(() => void refresh(), 5000)
    return () => clearInterval(t)
  }, [refresh])

  // SSE live feed: refresh lists on any session update; refetch the open
  // session (live tailing) when it is the one that changed.
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('session-updated', ev => {
      const data = JSON.parse((ev as MessageEvent).data) as { sessionId: string }
      void refresh()
      if (selectedRef.current === data.sessionId) {
        setRevision(r => r + 1)
      }
    })
    es.onerror = () => { /* EventSource reconnects automatically */ }
    return () => es.close()
  }, [refresh])

  // Ctrl+K search palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openSession = (id: string) => {
    setFocusSeq(null)
    setSelectedId(id)
  }
  const openFromSearch = (hit: SearchHit) => {
    setProjectId(hit.project_id)
    setSelectedId(hit.session_id)
    setFocusSeq(hit.seq)
    setSearchQ('')
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        projects={projects}
        projectId={projectId}
        onSelectProject={id => {
          setProjectId(id)
          setSelectedId(null)
        }}
        sessions={sessions}
        selectedId={selectedId}
        onOpenSession={openSession}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-edge bg-panel/70 px-5 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <OrbitIcon size={22} className="spin-slow text-neon" />
            <span className="glow-text font-mono text-lg font-bold tracking-[0.25em]">ORBIT</span>
          </div>
          {stats !== null && (
            <div className="hidden items-center gap-2 font-mono text-xs text-dim md:flex">
              <span className="rounded-md border border-edge bg-panel2 px-2 py-1">{stats.projects} projects</span>
              <span className="rounded-md border border-edge bg-panel2 px-2 py-1">{stats.sessions} sessions</span>
              <span className="flex items-center gap-1.5 rounded-md border border-neon/40 bg-panel2 px-2 py-1 text-neon">
                <Activity size={12} /> {stats.live} live
              </span>
              <span className="rounded-md border border-edge bg-panel2 px-2 py-1">{fmtTokens(stats.input_tokens + stats.output_tokens)} tok</span>
              <span className="rounded-md border border-edge bg-panel2 px-2 py-1">{fmtCost(stats.cost_cents)}</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <input
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="search sessions…"
                className="w-56 rounded-md border border-edge bg-panel2 py-1.5 pl-8 pr-3 font-mono text-xs text-txt placeholder-faint outline-none transition focus:border-neon/60 focus:glow-border"
              />
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">
          {error !== null && (
            <div className="m-4 rounded-md border border-err/40 bg-err/10 px-4 py-3 font-mono text-sm text-err">
              {error} — is the Orbit server running? (pnpm dev:server → :4810)
            </div>
          )}
          {selectedId === null
            ? <Overview stats={stats} sessions={sessions} onOpen={openSession} />
            : <SessionView id={selectedId} revision={revision} focusSeq={focusSeq} />}
        </main>
      </div>

      <SearchPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpen={openFromSearch}
      />
    </div>
  )
}
