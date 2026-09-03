import { Activity, Coins, FolderGit2, Sparkles, Zap } from 'lucide-react'
import type { GlobalStats, SessionSummary } from '../api.ts'
import { fmtCost, fmtTokens, timeAgo } from '../format.ts'

interface Props {
  stats: GlobalStats | null
  sessions: SessionSummary[]
  onOpen: (id: string) => void
}

export default function Overview({ stats, sessions, onOpen }: Props) {
  const cards = stats === null ? [] : [
    { icon: FolderGit2, label: 'Projects', value: String(stats.projects), tint: 'text-viol' },
    { icon: Sparkles, label: 'Sessions', value: String(stats.sessions), tint: 'text-neon' },
    { icon: Activity, label: 'Live now', value: String(stats.live), tint: 'text-ok' },
    { icon: Zap, label: 'Tokens', value: fmtTokens(stats.input_tokens + stats.output_tokens), tint: 'text-warn' },
    { icon: Coins, label: 'Est. cost', value: fmtCost(stats.cost_cents), tint: 'text-err' },
  ]
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-10">
        <h1 className="glow-text font-mono text-4xl font-bold tracking-[0.3em]">ORBIT</h1>
        <p className="mt-2 text-sm text-dim">Your Claude Code sessions, replayed as trajectories.</p>

        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
          {cards.map(card => (
            <div key={card.label} className="rounded-lg border border-edge bg-panel/80 px-4 py-4 transition hover:glow-border">
              <card.icon size={16} className={card.tint} />
              <div className="mt-3 font-mono text-xl font-semibold text-txt">{card.value}</div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-faint">{card.label}</div>
            </div>
          ))}
        </div>

        <h2 className="mt-10 font-mono text-[11px] uppercase tracking-[0.25em] text-dim">Recent sessions</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          {sessions.slice(0, 12).map(s => (
            <button
              key={s.id}
              onClick={() => onOpen(s.id)}
              className="group rounded-lg border border-edge bg-panel/80 px-4 py-3 text-left transition hover:glow-border"
            >
              <div className="flex items-center gap-2">
                {s.live && <span className="live-dot shrink-0" />}
                <span className="min-w-0 flex-1 truncate text-sm text-txt group-hover:text-neon">{s.title}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-faint">
                <span>{s.projectName.split(/[\\/]/).filter(Boolean).at(-1)}</span>
                <span className="text-edge">·</span>
                <span>{timeAgo(s.startedAt)}</span>
                <span className="text-edge">·</span>
                <span>{fmtTokens(s.tokens.input + s.tokens.output)} tok</span>
                <span className="text-edge">·</span>
                <span>{fmtCost(s.costCents)}</span>
                {s.model !== null && <span className="ml-auto truncate text-faint">{s.model.split('-').slice(1, 3).join('-')}</span>}
              </div>
            </button>
          ))}
          {sessions.length === 0 && (
            <div className="col-span-2 rounded-lg border border-dashed border-edge px-4 py-10 text-center font-mono text-sm text-faint">
              no sessions indexed yet
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
