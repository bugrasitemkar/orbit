import { FolderGit2, Layers } from 'lucide-react'
import type { ProjectRollup, SessionSummary } from '../api.ts'
import { fmtCost, fmtTokens, timeAgo } from '../format.ts'

interface Props {
  projects: ProjectRollup[]
  projectId: number | null
  onSelectProject: (id: number | null) => void
  sessions: SessionSummary[]
  selectedId: string | null
  onOpenSession: (id: string) => void
}

function tailOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

export default function Sidebar({ projects, projectId, onSelectProject, sessions, selectedId, onOpenSession }: Props) {
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-edge bg-panel/60">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3 pb-2 pt-3">
          <button
            onClick={() => onSelectProject(null)}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition ${
              projectId === null
                ? 'glow-border-viol bg-viol/10 text-txt'
                : 'text-dim hover:bg-panel2 hover:text-txt'
            }`}
          >
            <Layers size={14} className={projectId === null ? 'text-viol' : ''} />
            All sessions
          </button>
        </div>

        <div className="px-5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">Projects</div>
        {projects.map(p => (
          <button
            key={p.id}
            onClick={() => onSelectProject(p.id)}
            className={`group flex w-full items-center gap-2 px-5 py-1.5 text-left text-sm transition ${
              projectId === p.id ? 'bg-panel2 text-txt glow-border-viol' : 'text-dim hover:bg-panel2/60 hover:text-txt'
            }`}
          >
            <FolderGit2 size={13} className={projectId === p.id ? 'text-viol' : 'text-faint group-hover:text-dim'} />
            <span className="min-w-0 flex-1 truncate">{tailOf(p.name)}</span>
            <span className="font-mono text-[10px] text-faint">{p.session_count}</span>
          </button>
        ))}

        <div className="px-5 pb-1 pt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
          {projectId === null ? 'Recent sessions' : 'Sessions'}
        </div>
        {sessions.length === 0 && (
          <div className="px-5 py-3 text-xs text-faint">No sessions here yet — run Claude Code and Orbit picks them up.</div>
        )}
        {sessions.map(s => (
          <button
            key={s.id}
            onClick={() => onOpenSession(s.id)}
            className={`cell-row block w-full px-5 py-2 text-left ${
              selectedId === s.id ? 'selected' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              {s.live && <span className="live-dot shrink-0" title="live" />}
              <span className="min-w-0 flex-1 truncate text-[13px] text-txt">{s.title}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 pl-[15px] font-mono text-[10px] text-faint">
              <span>{timeAgo(s.startedAt)}</span>
              <span className="text-edge">·</span>
              <span>{fmtTokens(s.tokens.input + s.tokens.output)}</span>
              <span className="text-edge">·</span>
              <span>{fmtCost(s.costCents)}</span>
              {s.subagentCount > 0 && <span className="text-viol">{s.subagentCount} agent{s.subagentCount > 1 ? 's' : ''}</span>}
            </div>
          </button>
        ))}
      </div>
      <div className="border-t border-edge px-5 py-3 font-mono text-[10px] text-faint">
        ~/.claude/projects · read-only
      </div>
    </aside>
  )
}
