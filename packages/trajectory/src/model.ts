/**
 * Canonical trajectory model, mirroring DSH's trajectory view model
 * (Turns → Groups → Cells) adapted to Claude Code JSONL transcripts.
 */

/** One parsed JSONL line. Defensive: every field is optional. */
export interface ClaudeRow {
  line: number
  type: string
  subtype: string | null
  timestamp: string | null
  uuid: string | null
  parentUuid: string | null
  sessionId: string | null
  raw: Record<string, unknown>
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: string }
  | { type: 'tool_result'; toolUseId: string; text: string; isError: boolean }
  | { type: 'other'; data: unknown }

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface SessionMeta {
  sessionId: string
  projectDir: string
  filePath: string
  title: string
  model: string | null
  ccVersion: string | null
  mode: string | null
  gitBranch: string | null
  startedAt: number | null
  endedAt: number | null
  lineCount: number
  isSubagent: boolean
  parentSessionId: string | null
  tokens: TokenUsage
  costCents: number | null
  files: string[]
  toolCounts: Record<string, number>
}

export type CellKind =
  | 'user'
  | 'message'
  | 'tool'
  | 'subtool'
  | 'system'
  | 'compacted'
  | 'context'

/** One row in the trajectory table (DSH TrajectoryCell equivalent). */
export interface TrajectoryCell {
  kind: CellKind
  index: number
  text?: string
  previewMarkdown?: string
  inputDetail?: string
  outputDetail?: string
  thinkingDetail?: string
  callId?: string
  isError?: boolean
  /** Own duration in seconds; null when in-flight or unknowable. */
  timeSeconds: number | null
  startedAt: number | null
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  think?: number
  requestOnly?: boolean
  sourceSeq: number
}

export interface TrajectoryGroup {
  title: string
  description?: string
  cells: TrajectoryCell[]
}

export interface TrajectoryTurn {
  turn: number | null
  groups: TrajectoryGroup[]
}

export interface UsagePoint {
  turn: number
  step: number
  time: number | null
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costCents: number | null
}

export interface AgentSummary {
  id: string
  label: string
  kind?: 'task' | 'subagent-session'
  /** Main-session tool call that spawned this agent (task notifications). */
  toolUseId?: string
  sessionId: string | null
  model: string | null
  toolCount: number
  outputTokens: number
  startedAt: number | null
  endedAt: number | null
  durationMs: number | null
  status: 'running' | 'done' | 'error'
}

export interface TrajectorySession {
  meta: SessionMeta
  turns: TrajectoryTurn[]
  agents: AgentSummary[]
  usage: UsagePoint[]
}
