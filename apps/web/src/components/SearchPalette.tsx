import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { api, type SearchHit } from '../api.ts'

interface Props {
  open: boolean
  onClose: () => void
  onOpen: (hit: SearchHit) => void
}

/** ⟦⟧-marked snippet rendered with highlighted match spans. */
function Snippet({ snippet }: { snippet: string }) {
  const parts = snippet.split(/(⟦|⟧)/)
  return (
    <span className="font-mono text-[11px] leading-5 text-dim">
      {parts.map((part, i) =>
        part === '⟦' || part === '⟧' ? null : (
          <span key={i} className={i > 0 && parts[i - 1] === '⟦' ? 'rounded-sm bg-neon/20 text-txt' : undefined}>
            {part}
          </span>
        ),
      )}
    </span>
  )
}

export default function SearchPalette({ open, onClose, onOpen }: Props) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setHits([])
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const trimmed = q.trim()
    if (trimmed === '') {
      setHits([])
      return
    }
    setLoading(true)
    const timer = setTimeout(() => {
      void api.search(trimmed)
        .then(res => setHits(res.hits))
        .catch(() => setHits([]))
        .finally(() => setLoading(false))
    }, 150)
    return () => clearTimeout(timer)
  }, [q, open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-void/70 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-edge bg-panel shadow-[0_0_40px_rgba(34,211,238,0.12)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-edge px-4">
          <Search size={15} className="text-neon" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'Enter' && hits.length > 0) {
                onOpen(hits[0]!)
                onClose()
              }
            }}
            placeholder="search every session — full text…"
            className="flex-1 bg-transparent py-3.5 font-mono text-sm text-txt placeholder-faint outline-none"
          />
          <kbd className="rounded border border-edge bg-panel2 px-1.5 py-0.5 font-mono text-[9px] text-faint">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {loading && <div className="px-4 py-3 font-mono text-xs text-faint">searching…</div>}
          {!loading && q.trim() !== '' && hits.length === 0 && (
            <div className="px-4 py-3 font-mono text-xs text-faint">no matches</div>
          )}
          {!loading && q.trim() === '' && (
            <div className="px-4 py-3 font-mono text-xs text-faint">type to search message text, tool results and titles</div>
          )}
          {hits.map(hit => (
            <button
              key={`${hit.session_id}-${hit.seq}`}
              onClick={() => {
                onOpen(hit)
                onClose()
              }}
              className="block w-full border-b border-edge/50 px-4 py-2.5 text-left transition hover:bg-neon/5"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-txt">{hit.title}</span>
                <span className="shrink-0 font-mono text-[10px] text-faint">
                  {hit.project_name.split(/[\\/]/).filter(Boolean).at(-1)} · line {hit.seq}
                </span>
              </div>
              <div className="mt-0.5">
                <Snippet snippet={hit.snippet} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
