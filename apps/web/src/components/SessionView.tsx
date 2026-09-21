import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleX,
  GitBranch,
  Info,
  Loader2,
  Minimize2,
  Play,
  Settings,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from 'lucide-react'
import type { AgentSummary, TrajectoryCell, UsagePoint } from '@orbit/trajectory'
import { api, type SessionDetail, type SessionSummary } from '../api.ts'
import { fmtClock, fmtCost, fmtDate, fmtSeconds, fmtTokens } from '../format.ts'
import FileDiffs from './FileDiffs.tsx'

type Tab = 'timeline' | 'graph' | 'analytics' | 'files'
type ViewMode = 'transcript' | 'rail'

const KIND_META: Record<string, { icon: typeof Sparkles; tint: string; label: string }> = {
  user: { icon: ChevronRight, tint: 'text-neon', label: 'user' },
  message: { icon: Sparkles, tint: 'text-viol', label: 'message' },
  tool: { icon: Wrench, tint: 'text-neon', label: 'tool' },
  subtool: { icon: Terminal, tint: 'text-dim', label: 'subtool' },
  system: { icon: Settings, tint: 'text-dim', label: 'system' },
  compacted: { icon: Minimize2, tint: 'text-warn', label: 'compacted' },
  context: { icon: Info, tint: 'text-dim', label: 'context' },
}

interface Props {
  id: string
  revision: number
  focusSeq?: number | null
}

export default function SessionView({ id, revision, focusSeq }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('timeline')
  const [viewMode, setViewMode] = useState<ViewMode>('transcript')
  const [playhead, setPlayhead] = useState<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const [selected, setSelected] = useState<TrajectoryCell | null>(null)
  const [resumeMsg, setResumeMsg] = useState<string | null>(null)

  useEffect(() => {
    setSelected(null)
    setError(null)
    setResumeMsg(null)
    setPlayhead(null)
    setFocused(null)
    setViewMode('transcript')
    void api.session(id).then(setDetail).catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [id, revision])

  const meta = detail?.meta ?? null
  const trajectory = detail?.trajectory ?? null

  // Search jump: reveal and focus the cell that carries the hit sequence.
  useEffect(() => {
    if (focusSeq == null || trajectory === null) return
    const target = trajectory.turns
      .flatMap(t => t.groups.flatMap(g => g.cells))
      .find(c => c.sourceSeq === focusSeq)
    if (target !== undefined) {
      setPlayhead(target.index)
      setFocused(target.index)
      setTimeout(() => {
        document.getElementById(`cell-${target.index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 150)
    }
  }, [focusSeq, trajectory])

  const duration = useMemo(() => {
    if (meta === null || meta.startedAt == null || meta.endedAt == null) return null
    return (meta.endedAt - meta.startedAt) / 1000
  }, [meta])

  const resume = async () => {
    if (meta === null) return
    setResumeMsg('launching…')
    const result = await api.resume(meta.id)
    setResumeMsg(result.ok ? 'launched in a new terminal' : result.error ?? 'failed')
  }

  if (error !== null) {
    return <div className="m-6 font-mono text-sm text-err">{error}</div>
  }
  if (meta === null || trajectory === null) {
    return (
      <div className="flex h-full items-center justify-center gap-3 font-mono text-sm text-dim">
        <Loader2 size={16} className="spin-slow text-neon" /> folding trajectory…
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Meta bar */}
        <div className="shrink-0 border-b border-edge bg-panel/60 px-6 py-3">
          <div className="flex items-center gap-2.5">
            {meta.live && <span className="live-dot" title="live session" />}
            <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-txt">{meta.title}</h2>
            <div className="flex shrink-0 items-center gap-1.5">
              {(['html', 'md', 'json'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => window.open(api.exportUrl(meta.id, f), '_blank')}
                  className="rounded border border-edge bg-panel2 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-dim transition hover:border-neon/50 hover:text-neon"
                >
                  {f}
                </button>
              ))}
              <button
                onClick={() => window.open(api.exportRawUrl(meta.id), '_blank')}
                title="download the raw .jsonl transcript(s) from ~/.claude/projects, zipped if there are subagent transcripts"
                className="rounded border border-edge bg-panel2 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-dim transition hover:border-neon/50 hover:text-neon"
              >
                raw
              </button>
              <button
                onClick={() => void resume()}
                className="flex items-center gap-1 rounded border border-viol/40 bg-viol/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-viol transition hover:glow-border-viol"
              >
                <Play size={10} /> resume
              </button>
            </div>
          </div>
          {resumeMsg !== null && (
            <div className="mt-1 font-mono text-[10px] text-neon">{resumeMsg}</div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-dim">
            <span className="rounded border border-edge bg-panel2 px-1.5 py-0.5">{meta.model ?? 'unknown model'}</span>
            {meta.mode !== null && <span className="rounded border border-edge bg-panel2 px-1.5 py-0.5">{meta.mode}</span>}
            {meta.gitBranch !== null && (
              <span className="flex items-center gap-1 rounded border border-edge bg-panel2 px-1.5 py-0.5">
                <GitBranch size={10} /> {meta.gitBranch}
              </span>
            )}
            <span className="rounded border border-edge bg-panel2 px-1.5 py-0.5">{fmtDate(meta.startedAt)}</span>
            <span className="rounded border border-edge bg-panel2 px-1.5 py-0.5">{fmtSeconds(duration)}</span>
            <span className="rounded border border-edge bg-panel2 px-1.5 py-0.5">
              {fmtTokens(meta.tokens.input)}→{fmtTokens(meta.tokens.output)} tok
            </span>
            <span className="rounded border border-edge bg-panel2 px-1.5 py-0.5">{fmtCost(meta.costCents)}</span>
            {meta.subagentCount > 0 && (
              <span className="rounded border border-viol/40 bg-viol/10 px-1.5 py-0.5 text-viol">
                {meta.subagentCount} agent{meta.subagentCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 items-center gap-1 border-b border-edge px-4">
          {(['timeline', 'graph', 'analytics', 'files'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-b-2 px-3 py-2 font-mono text-xs uppercase tracking-[0.15em] transition ${
                tab === t
                  ? 'border-neon text-neon'
                  : 'border-transparent text-faint hover:text-dim'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {tab === 'timeline' && (
            <Timeline
              trajectory={trajectory}
              selected={selected}
              onSelect={setSelected}
              viewMode={viewMode}
              onViewMode={setViewMode}
              playhead={playhead}
              onPlayhead={setPlayhead}
              focused={focused}
            />
          )}
          {tab === 'graph' && <AgentGraph meta={meta} agents={trajectory.agents} />}
          {tab === 'analytics' && <AnalyticsView id={meta.id} />}
          {tab === 'files' && <FileDiffs id={meta.id} />}
        </div>
      </div>

      {selected !== null && (
        <Inspector cell={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function allCells(trajectory: NonNullable<SessionDetail['trajectory']>): TrajectoryCell[] {
  return trajectory.turns.flatMap(t => t.groups.flatMap(g => g.cells))
}

function Timeline({ trajectory, selected, onSelect, viewMode, onViewMode, playhead, onPlayhead, focused }: {
  trajectory: NonNullable<SessionDetail['trajectory']>
  selected: TrajectoryCell | null
  onSelect: (cell: TrajectoryCell | null) => void
  viewMode: ViewMode
  onViewMode: (mode: ViewMode) => void
  playhead: number | null
  onPlayhead: (index: number | null) => void
  focused: number | null
}) {
  const cells = allCells(trajectory)
  const total = cells.reduce((max, c) => Math.max(max, c.index), 0)
  const cutoff = playhead ?? total
  const isVisible = (cell: TrajectoryCell): boolean => cell.index <= cutoff
  const railCells = cells.filter(c => isVisible(c) && (c.kind === 'tool' || c.kind === 'subtool'))

  return (
    <div className="mx-auto max-w-4xl">
      {/* Scrubber + view toggle */}
      <div className="sticky top-0 z-20 -mx-2 mb-4 flex items-center gap-3 rounded-md border border-edge/60 bg-void/95 px-3 py-2 backdrop-blur">
        <div className="flex overflow-hidden rounded-md border border-edge">
          {(['transcript', 'rail'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => onViewMode(mode)}
              className={`px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.15em] transition ${
                viewMode === mode ? 'bg-neon/15 text-neon' : 'bg-panel2 text-faint hover:text-dim'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        <button
          onClick={() => onPlayhead(0)}
          title="jump to start"
          className="rounded p-1 text-faint transition hover:text-neon"
        >
          <ChevronsLeft size={14} />
        </button>
        <input
          type="range"
          min={0}
          max={total}
          value={cutoff}
          onChange={e => {
            const v = Number(e.target.value)
            onPlayhead(v >= total ? null : v)
          }}
          className="orbit-range min-w-0 flex-1"
          title="scrub through the session"
        />
        <button
          onClick={() => onPlayhead(null)}
          title="jump to end"
          className="rounded p-1 text-faint transition hover:text-neon"
        >
          <ChevronsRight size={14} />
        </button>
        <span className="shrink-0 font-mono text-[10px] text-faint">
          {playhead === null ? 'live' : `${cutoff}/${total}`}
        </span>
      </div>

      {viewMode === 'rail' && (
        <div className="overflow-hidden rounded-lg border border-edge/70 bg-panel/50">
          <div className="flex items-center gap-3 border-b border-edge bg-panel2/60 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-faint">
            <span className="w-12">time</span>
            <span className="w-14">dur</span>
            <span className="w-4" />
            <span className="w-32">tool</span>
            <span className="min-w-0 flex-1">input</span>
          </div>
          {railCells.length === 0 && (
            <div className="px-3 py-4 font-mono text-xs text-faint">no tool calls in view</div>
          )}
          {railCells.map(cell => (
            <button
              key={cell.index}
              onClick={() => onSelect(selected?.index === cell.index ? null : cell)}
              className={`cell-row block w-full border-b border-edge/40 px-3 py-1 font-mono text-[11px] transition last:border-b-0 ${
                selected?.index === cell.index || focused === cell.index ? 'selected' : ''
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="w-12 text-faint">{fmtClock(cell.startedAt)}</span>
                <span className="w-14 text-dim">{fmtSeconds(cell.timeSeconds)}</span>
                <span className="w-4">
                  {cell.isError === true
                    ? <CircleX size={12} className="text-err" />
                    : cell.timeSeconds !== null
                      ? <Check size={12} className="text-ok" />
                      : <Activity size={12} className="animate-pulse text-neon" />}
                </span>
                <span className="w-32 truncate text-neon">{cell.text ?? ''}</span>
                <span className="min-w-0 flex-1 truncate text-dim">{cell.previewMarkdown ?? ''}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {viewMode === 'transcript' && trajectory.turns.map((turn, ti) => {
        const turnVisible = turn.groups.some(g => g.cells.some(isVisible))
        if (!turnVisible) return null
        const firstVisible = turn.groups.flatMap(g => g.cells).find(isVisible)
        return (
          <section key={ti} className="mb-6">
            <div className="sticky top-10 z-10 -mx-2 flex items-baseline gap-3 rounded-md bg-void/90 px-3 py-2 backdrop-blur">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-viol">
                turn {turn.turn}
              </span>
              <span className="font-mono text-[10px] text-faint">
                {firstVisible !== undefined && firstVisible.startedAt !== null
                  ? fmtClock(firstVisible.startedAt)
                  : ''}
              </span>
              <span className="h-px flex-1 bg-gradient-to-r from-viol/40 to-transparent" />
            </div>
            {turn.groups.map((group, gi) => {
              const visibleCells = group.cells.filter(isVisible)
              if (visibleCells.length === 0) return null
              return (
                <div key={gi} className="mt-2">
                  <div className="flex items-baseline gap-3 px-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">{group.title}</span>
                    {group.description !== undefined && (
                      <span className="font-mono text-[10px] text-neon/80">{group.description}</span>
                    )}
                  </div>
                  <div className="mt-1.5 rounded-lg border border-edge/70 bg-panel/50">
                    {visibleCells.map(cell => (
                      <CellRow
                        key={cell.index}
                        cell={cell}
                        selected={selected?.index === cell.index}
                        focused={focused === cell.index}
                        onClick={() => onSelect(selected?.index === cell.index ? null : cell)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}

function CellRow({ cell, selected, focused, onClick }: {
  cell: TrajectoryCell
  selected: boolean
  focused: boolean
  onClick: () => void
}) {
  const meta = KIND_META[cell.kind] ?? KIND_META.context!
  const Icon = meta.icon
  const toolSettled = cell.kind === 'tool' && cell.timeSeconds !== null
  const running = cell.kind === 'tool' && cell.timeSeconds === null
  return (
    <button
      id={`cell-${cell.index}`}
      onClick={onClick}
      className={`cell-row block w-full px-3 py-1.5 text-left ${selected || focused ? 'selected' : ''}`}
    >
      <div className="flex items-center gap-2.5">
        <Icon size={13} className={`shrink-0 ${meta.tint}`} />
        <span className="w-16 shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-faint">{meta.label}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-txt">
          {cell.kind === 'tool' && (
            <span className="font-mono text-xs text-neon">{cell.text} </span>
          )}
          {cell.previewMarkdown ?? cell.text ?? ''}
        </span>
        {cell.kind === 'tool' && (
          <>
            {cell.isError === true
              ? <CircleX size={13} className="shrink-0 text-err" />
              : toolSettled
                ? <Check size={13} className="shrink-0 text-ok" />
                : null}
            {running && <Activity size={12} className="shrink-0 animate-pulse text-neon" />}
          </>
        )}
        {cell.kind === 'message' && cell.input !== undefined && (
          <span className="shrink-0 font-mono text-[10px] text-faint">
            {fmtTokens(cell.input)}→{fmtTokens(cell.output)}
          </span>
        )}
        <span className="w-14 shrink-0 text-right font-mono text-[10px] text-dim">
          {fmtSeconds(cell.timeSeconds)}
        </span>
      </div>
    </button>
  )
}

function Inspector({ cell, onClose }: { cell: TrajectoryCell; onClose: () => void }) {
  const meta = KIND_META[cell.kind] ?? KIND_META.context!
  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-edge bg-panel/80">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-2.5">
        <span className={`font-mono text-[10px] uppercase tracking-[0.2em] ${meta.tint}`}>{meta.label}</span>
        <span className="font-mono text-[10px] text-faint">· seq {cell.sourceSeq}</span>
        <button onClick={onClose} className="ml-auto rounded p-1 text-faint transition hover:bg-panel2 hover:text-txt">
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {cell.kind === 'tool' && cell.callId !== undefined && (
          <Section title="call id">
            <code>{cell.callId}</code>
          </Section>
        )}
        {(cell.input !== undefined || cell.kind === 'message') && (
          <Section title="tokens">
            {cell.input !== undefined
              ? `in ${cell.input.toLocaleString()} · out ${cell.output?.toLocaleString() ?? '—'} · cache r ${cell.cacheRead?.toLocaleString() ?? 0} · cache w ${cell.cacheWrite?.toLocaleString() ?? 0}`
              : '—'}
          </Section>
        )}
        {cell.startedAt !== null && (
          <Section title="timing">
            {fmtDate(cell.startedAt)} · {fmtSeconds(cell.timeSeconds)} own duration
          </Section>
        )}
        {cell.inputDetail !== undefined && (
          <Section title="input">
            <code>{cell.inputDetail}</code>
          </Section>
        )}
        {cell.outputDetail !== undefined && (
          <Section title="output">
            <code>{cell.outputDetail}</code>
          </Section>
        )}
        {cell.thinkingDetail !== undefined && (
          <Section title="thinking">
            <code>{cell.thinkingDetail}</code>
          </Section>
        )}
        {cell.inputDetail === undefined && cell.outputDetail === undefined && cell.thinkingDetail === undefined && (
          <div className="font-mono text-xs text-faint">no details for this cell</div>
        )}
      </div>
    </aside>
  )
}

function AgentGraph({ meta, agents }: { meta: SessionSummary; agents: AgentSummary[] }) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="relative ml-5 border-l-2 border-edge pb-8 pl-10">
        {/* Main node */}
        <div className="relative">
          <span className="absolute -left-[49px] top-5 h-3 w-3 rounded-full bg-viol shadow-[0_0_10px_rgba(167,139,250,0.7)]" />
          <div className="rounded-lg border border-viol/40 bg-panel/70 px-4 py-3 glow-border-viol">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-viol" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-txt">{meta.title}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] text-dim">
              <span className="rounded bg-panel2 px-1.5 py-0.5">{meta.model ?? 'unknown'}</span>
              <span className="rounded bg-panel2 px-1.5 py-0.5">{fmtTokens(meta.tokens.input + meta.tokens.output)} tok</span>
              <span className="rounded bg-panel2 px-1.5 py-0.5">{fmtCost(meta.costCents)}</span>
              {meta.live && <span className="rounded bg-neon/10 px-1.5 py-0.5 text-neon">live</span>}
            </div>
          </div>
        </div>

        {agents.length === 0 && (
          <div className="mt-6 font-mono text-xs text-faint">
            no subagents spawned in this session
          </div>
        )}
        {agents.map(agent => (
          <div key={`${agent.kind}-${agent.id}`} className="relative mt-4">
            <span
              className={`absolute -left-[45px] top-5 h-2.5 w-2.5 rounded-full ${
                agent.status === 'running'
                  ? 'live-dot'
                  : agent.status === 'error'
                    ? 'bg-err shadow-[0_0_8px_rgba(248,113,113,0.6)]'
                    : 'bg-ok shadow-[0_0_8px_rgba(52,211,153,0.5)]'
              }`}
            />
            <div className={`rounded-lg border px-4 py-3 transition hover:glow-border ${
              agent.status === 'running' ? 'border-neon/50 bg-panel/70' : 'border-edge bg-panel/50'
            }`}>
              <div className="flex items-center gap-2">
                <Bot size={14} className={agent.status === 'running' ? 'text-neon' : 'text-dim'} />
                <span className="min-w-0 flex-1 truncate text-sm text-txt">{agent.label}</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
                  {agent.kind === 'task' ? 'task' : 'session'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] text-dim">
                {agent.toolCount > 0 && (
                  <span className="rounded bg-panel2 px-1.5 py-0.5">{agent.toolCount} tools</span>
                )}
                {agent.outputTokens > 0 && (
                  <span className="rounded bg-panel2 px-1.5 py-0.5">{fmtTokens(agent.outputTokens)} tok</span>
                )}
                {agent.durationMs !== null && (
                  <span className="rounded bg-panel2 px-1.5 py-0.5">{fmtSeconds(agent.durationMs / 1000)}</span>
                )}
                {agent.model !== null && (
                  <span className="rounded bg-panel2 px-1.5 py-0.5">{agent.model}</span>
                )}
                {agent.startedAt !== null && (
                  <span className="rounded bg-panel2 px-1.5 py-0.5">{fmtClock(agent.startedAt)}</span>
                )}
                {agent.toolUseId !== undefined && (
                  <span className="truncate rounded bg-panel2 px-1.5 py-0.5 text-faint" title={`spawned by ${agent.toolUseId}`}>
                    ↳ {agent.toolUseId.slice(0, 12)}…
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AnalyticsView({ id }: { id: string }) {
  const [usage, setUsage] = useState<UsagePoint[] | null>(null)

  useEffect(() => {
    setUsage(null)
    void api.usage(id).then(setUsage).catch(() => setUsage([]))
  }, [id])

  if (usage === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 font-mono text-xs text-dim">
        <Loader2 size={14} className="spin-slow text-neon" /> loading usage…
      </div>
    )
  }
  if (usage.length === 0) {
    return <div className="m-6 font-mono text-xs text-faint">no usage data recorded in this session</div>
  }

  const W = 800
  const H = 190
  const P = 10
  const n = usage.length
  const maxTotal = Math.max(
    ...usage.map(u => u.input + u.output + u.cacheRead + u.cacheWrite),
    1,
  )
  const x = (i: number): number => P + (i / Math.max(1, n - 1)) * (W - 2 * P)
  const y = (v: number): number => H - P - (v / maxTotal) * (H - 2 * P)

  const layers = [
    { key: 'cacheWrite', label: 'cache write', color: '#3b3b58' },
    { key: 'cacheRead', label: 'cache read', color: '#56566f' },
    { key: 'input', label: 'input', color: '#22d3ee' },
    { key: 'output', label: 'output', color: '#a78bfa' },
  ] as const

  const areaPath = (layer: (typeof layers)[number]): string => {
    let d = ''
    for (let i = 0; i < n; i++) {
      const u = usage[i]
      if (u === undefined) continue
      let base = 0
      for (const l of layers) {
        if (l.key === layer.key) break
        base += u[l.key]
      }
      const top = base + u[layer.key]
      d += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(top).toFixed(1)} `
    }
    for (let i = n - 1; i >= 0; i--) {
      const u = usage[i]
      if (u === undefined) continue
      let base = 0
      for (const l of layers) {
        if (l.key === layer.key) break
        base += u[l.key]
      }
      d += `L${x(i).toFixed(1)},${y(base).toFixed(1)} `
    }
    return d + 'Z'
  }

  const cumulative: number[] = []
  for (const u of usage) {
    cumulative.push((cumulative.at(-1) ?? 0) + (u.costCents ?? 0))
  }
  const maxCost = Math.max(...cumulative, 1)
  const costPath = cumulative.map((c, i) =>
    `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${(H - P - (c / maxCost) * (H - 2 * P)).toFixed(1)}`,
  ).join(' ')

  const totals = usage.reduce(
    (acc, u) => ({
      input: acc.input + u.input,
      output: acc.output + u.output,
      cacheRead: acc.cacheRead + u.cacheRead,
      cacheWrite: acc.cacheWrite + u.cacheWrite,
      cost: acc.cost + (u.costCents ?? 0),
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  )

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap gap-2 font-mono text-[10px] text-dim">
        {layers.map(l => (
          <span key={l.key} className="flex items-center gap-1.5 rounded border border-edge bg-panel2 px-2 py-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: l.color }} />
            {l.label} {fmtTokens(totals[l.key])}
          </span>
        ))}
        <span className="rounded border border-edge bg-panel2 px-2 py-1">est. {fmtCost(totals.cost)}</span>
        <span className="rounded border border-edge bg-panel2 px-2 py-1">{n} steps</span>
      </div>

      <div className="mt-4 rounded-lg border border-edge bg-panel/50 p-3">
        <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-faint">
          tokens per step (stacked)
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" preserveAspectRatio="none">
          {layers.map(l => (
            <path key={l.key} d={areaPath(l)} fill={l.color} fillOpacity={0.75} stroke={l.color} strokeOpacity={0.4} strokeWidth={0.5} />
          ))}
        </svg>
      </div>

      <div className="mt-4 rounded-lg border border-edge bg-panel/50 p-3">
        <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-faint">
          cumulative estimated cost
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" preserveAspectRatio="none">
          <path
            d={`${costPath} L${x(n - 1).toFixed(1)},${H - P} L${x(0).toFixed(1)},${H - P} Z`}
            fill="rgba(34,211,238,0.08)"
          />
          <path d={costPath} fill="none" stroke="#22d3ee" strokeWidth={1.5} />
        </svg>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">{title}</div>
      <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-dim">{children}</div>
    </div>
  )
}
