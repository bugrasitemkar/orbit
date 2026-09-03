/**
 * Agent graph derivation: task-notifications from `queue-operation` rows
 * (Claude Code 2.x) matched to main-session tool calls, plus subagent
 * transcript sessions indexed as children of the parent session.
 */
import type { Database } from 'bun:sqlite'
import type { AgentSummary, ClaudeRow } from '@orbit/trajectory'
import { parseLine, rowTime } from '@orbit/trajectory'
import { childSessions, LIVE_WINDOW_MS, type SessionRow } from './db.ts'

interface TaskNotification {
  taskId: string | null
  toolUseId: string | null
  status: string | null
  summary: string | null
  tokens: number | null
  toolUses: number | null
  durationMs: number | null
}

const TAG_RE = /<([a-z_-]+)>([^<]*)<\/\1>/g

function field(tags: Record<string, string>, name: string): string | null {
  const v = tags[name]
  return v === undefined ? null : v.trim()
}

function num(v: string | null): number | null {
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function parseTaskNotifications(content: string): TaskNotification[] {
  const out: TaskNotification[] = []
  const noteRe = /<task-notification>([\s\S]*?)<\/task-notification>/g
  let match: RegExpExecArray | null
  while ((match = noteRe.exec(content)) !== null) {
    const body = match[1] ?? ''
    const tags: Record<string, string> = {}
    let tag: RegExpExecArray | null
    TAG_RE.lastIndex = 0
    while ((tag = TAG_RE.exec(body)) !== null) {
      if (tag[1] !== undefined && tag[2] !== undefined) tags[tag[1]] = tag[2]
    }
    out.push({
      taskId: field(tags, 'task-id'),
      toolUseId: field(tags, 'tool-use-id'),
      status: field(tags, 'status'),
      summary: field(tags, 'summary'),
      tokens: num(field(tags, 'subagent_tokens')),
      toolUses: num(field(tags, 'tool_uses')),
      durationMs: num(field(tags, 'duration_ms')),
    })
  }
  return out
}

/** Label a task notification: quoted agent name first, else first line. */
function notificationLabel(n: TaskNotification): string {
  const summary = n.summary ?? 'subagent'
  const quoted = /Agent "([^"]+)"/.exec(summary)
  if (quoted !== null && quoted[1] !== undefined) return quoted[1]
  const firstLine = summary.split(/\r?\n/, 1)[0]?.trim() ?? 'subagent'
  return firstLine.length > 90 ? `${firstLine.slice(0, 89)}…` : firstLine
}

export function deriveAgents(
  db: Database,
  session: SessionRow,
  lines: { seq: number; time: number | null; kind: string; line: string }[],
): AgentSummary[] {
  const agents: AgentSummary[] = []
  const seenToolUseIds = new Set<string>()

  for (const entry of lines) {
    if (entry.kind !== 'queue-operation') continue
    const row: ClaudeRow | null = parseLine(entry.line, entry.seq)
    if (row === null || typeof row.raw.content !== 'string') continue
    const notes = parseTaskNotifications(row.raw.content)
    for (const note of notes) {
      if (note.toolUseId === null) continue
      const call = db.query<{ started_at: number | null; seq: number; name: string },
        [string, string]>('SELECT started_at, seq, name FROM tool_calls WHERE call_id = ? AND session_id = ?')
        .get(note.toolUseId, session.id)
      const startedAt = call?.started_at ?? null
      const endedAt = startedAt !== null && note.durationMs !== null
        ? startedAt + note.durationMs
        : startedAt !== null ? startedAt : null
      agents.push({
        id: note.taskId ?? note.toolUseId,
        label: notificationLabel(note),
        kind: 'task',
        toolUseId: note.toolUseId,
        sessionId: null,
        model: null,
        toolCount: note.toolUses ?? 0,
        outputTokens: note.tokens ?? 0,
        startedAt,
        endedAt,
        durationMs: note.durationMs,
        status: note.status === 'completed'
          ? 'done'
          : note.status === 'failed' || note.status === 'error' ? 'error' : 'running',
      })
      seenToolUseIds.add(note.toolUseId)
    }
  }

  const now = Date.now()
  for (const child of childSessions(db, session.id)) {
    const label = child.title.startsWith('<') ? 'subagent' : child.title
    agents.push({
      id: child.id,
      label,
      kind: 'subagent-session',
      sessionId: child.id,
      model: child.model,
      toolCount: 0,
      outputTokens: child.output_tokens,
      startedAt: child.started_at,
      endedAt: child.ended_at,
      durationMs: child.started_at !== null && child.ended_at !== null
        ? child.ended_at - child.started_at
        : null,
      status: child.file_mtime > now - LIVE_WINDOW_MS ? 'running' : 'done',
    })
  }

  // Order by first evidence of activity.
  return agents.sort((a, b) => (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER))
}
