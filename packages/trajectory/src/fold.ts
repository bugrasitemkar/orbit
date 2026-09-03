/**
 * Trajectory fold: parse Claude JSONL rows into the DSH-style view model —
 * Turns → Groups → Cells, with own-duration times, usage columns on Message
 * cells, tool call+result pairing, orphan folding, and group histograms.
 */
import type {
  ClaudeRow,
  SessionMeta,
  TokenUsage,
  TrajectoryCell,
  TrajectorySession,
  TrajectoryTurn,
  UsagePoint,
} from './model.ts'
import {
  aiTitleOf,
  editPaths,
  initFacts,
  messageBlocks,
  modelOf,
  rowTime,
  topLevelCwd,
  usageOf,
} from './parse.ts'
import { costCents } from './pricing.ts'

export interface FoldOptions {
  sessionId?: string | null
  filePath?: string
  projectDir?: string | null
  isSubagent?: boolean
}

interface CallRecord {
  callId: string
  name: string
  input: string
  callTime: number | null
  turn: number
  step: number
  resultText: string | null
  resultTime: number | null
  isError: boolean
}

interface ResultRecord {
  text: string
  isError: boolean
  time: number | null
}

interface LaidCell {
  cell: TrajectoryCell
  absTime: number | null
  toolName?: string
}

interface GroupBucket {
  title: string
  laid: LaidCell[]
}

interface TurnBucket {
  groups: GroupBucket[]
}

const MESSAGE_GROUP = 'Message'

export function formatSeconds(s: number | null): string {
  if (s === null || !Number.isFinite(s) || s < 0) return '—'
  if (s < 60) {
    const v = s < 10 ? s.toFixed(1) : String(Math.round(s))
    return `${v}s`
  }
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}m${String(sec).padStart(2, '0')}s`
}

/** Own-duration seconds from two epoch-ms stamps; null when either is unusable. */
function durationSeconds(later: number | null, earlier: number | null): number | null {
  if (later === null || earlier === null) return null
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return null
  return Math.max(0, (later - earlier) / 1000)
}

function firstLineOf(text: string, max: number): string {
  const first = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

export function foldSession(rows: ClaudeRow[], opts: FoldOptions = {}): TrajectorySession {
  /* ---------- Pass 1: session facts, call/result index, turn assignment ----- */
  const calls = new Map<string, CallRecord>()
  const results = new Map<string, ResultRecord>()
  const rowTurn = new Map<number, number>()
  const rowStep = new Map<number, number>()
  const stepsInTurn = new Map<number, number>()
  const usageRows: {
    turn: number
    step: number
    time: number | null
    tokens: TokenUsage
    model: string | null
  }[] = []

  let userTextCount = 0
  let lastAssistantTurn = 0
  let firstUserText: string | null = null
  let initModel: string | null = null
  let initCwd: string | null = null
  let initVersion: string | null = null
  let mode: string | null = null
  let gitBranch: string | null = null
  let firstModel: string | null = null
  let parentUuid: string | null = null
  let topCwd: string | null = null
  let aiTitle: string | null = null

  const userRowIndexes: number[] = []
  const summaryRows: { row: ClaudeRow; turn: number }[] = []

  for (const row of rows) {
    const time = rowTime(row)
    if (parentUuid === null) parentUuid = row.parentUuid
    if (gitBranch === null && typeof row.raw.gitBranch === 'string') {
      gitBranch = row.raw.gitBranch
    }
    const init = initFacts(row)
    if (init !== null) {
      initModel = init.model ?? initModel
      initCwd = init.cwd ?? initCwd
      initVersion = init.version ?? initVersion
    }
    if (topCwd === null) topCwd = topLevelCwd(row)
    if (aiTitle === null) aiTitle = aiTitleOf(row)
    if (row.type === 'system' && row.subtype === 'mode' && typeof row.raw.mode === 'string') {
      mode = row.raw.mode
    }
    const blocks = messageBlocks(row)
    if (row.type === 'user') {
      const hasText = blocks.some(b => b.type === 'text')
      if (hasText) {
        userTextCount++
        userRowIndexes.push(row.line)
        if (firstUserText === null) {
          const text = blocks.filter(b => b.type === 'text').map(b => (b.type === 'text' ? b.text : '')).join('\n')
          firstUserText = text
        }
      }
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          results.set(b.toolUseId, { text: b.text, isError: b.isError, time })
        }
      }
    } else if (row.type === 'assistant') {
      if (firstModel === null) firstModel = modelOf(row)
      const turn = Math.max(1, userTextCount)
      const step = (stepsInTurn.get(turn) ?? 0) + 1
      stepsInTurn.set(turn, step)
      rowTurn.set(row.line, turn)
      rowStep.set(row.line, step)
      lastAssistantTurn = turn
      const u = usageOf(row)
      if (u !== null) {
        usageRows.push({
          turn,
          step,
          time,
          tokens: {
            input: u.input,
            output: u.output,
            cacheRead: u.cacheRead,
            cacheWrite: u.cacheWrite,
          },
          model: modelOf(row),
        })
      }
      for (const b of blocks) {
        if (b.type === 'tool_use') {
          calls.set(b.id, {
            callId: b.id,
            name: b.name,
            input: b.input,
            callTime: time,
            turn,
            step,
            resultText: null,
            resultTime: null,
            isError: false,
          })
        }
      }
    } else if (row.type === 'summary') {
      summaryRows.push({ row, turn: lastAssistantTurn === 0 ? 1 : lastAssistantTurn })
    }
  }

  for (const [id, res] of results) {
    const call = calls.get(id)
    if (call !== undefined) {
      call.resultText = res.text
      call.resultTime = res.time
      call.isError = res.isError
    }
  }

  /* ---------- Pass 2: fold cells ------------------------------------------- */
  let index = 0
  let prevAbsTime: number | null = null
  const turns = new Map<number, TurnBucket>()
  const bucket = (turn: number): TurnBucket => {
    let entry = turns.get(turn)
    if (entry === undefined) {
      entry = { groups: [] }
      turns.set(turn, entry)
    }
    return entry
  }
  const pushGroup = (turn: number, title: string, laid: LaidCell[]): void => {
    if (laid.length === 0) return
    const groups = bucket(turn).groups
    const existing = groups.find(g => g.title === title)
    if (existing !== undefined) existing.laid.push(...laid)
    else groups.push({ title, laid: [...laid] })
  }
  const pushMessage = (turn: number, laid: LaidCell[]): void =>
    pushGroup(turn, MESSAGE_GROUP, laid)
  const pushStep = (turn: number, step: number, laid: LaidCell[]): void =>
    pushGroup(turn, `Step ${step}`, laid)

  // Next assistant turn after each user text row (turn enclosure rule).
  const nextAssistantTurn = new Map<number, number>()
  {
    let next: number | null = null
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]
      if (row === undefined) continue
      if (row.type === 'assistant') next = rowTurn.get(row.line) ?? null
      else if (next !== null) nextAssistantTurn.set(row.line, next)
    }
  }

  for (const row of rows) {
    const time = rowTime(row)
    const blocks = messageBlocks(row)
    if (row.type === 'user') {
      const textBlocks = blocks.filter(b => b.type === 'text').map(b => (b.type === 'text' ? b.text : ''))
      if (textBlocks.length > 0) {
        const text = textBlocks.join('\n')
        const turn = nextAssistantTurn.get(row.line)
          ?? (lastAssistantTurn === 0 ? 1 : lastAssistantTurn + 1)
        pushMessage(turn, [{
          absTime: time,
          cell: {
            kind: 'user',
            index: ++index,
            text,
            sourceSeq: row.line,
            timeSeconds: 0,
            startedAt: time,
          },
        }])
      }
      // tool_result blocks are folded into their assistant's tool cells.
      prevAbsTime = time ?? prevAbsTime
    } else if (row.type === 'assistant') {
      const turn = rowTurn.get(row.line) ?? 1
      const step = rowStep.get(row.line) ?? 1
      const u = usageOf(row)
      const text = blocks.filter(b => b.type === 'text').map(b => (b.type === 'text' ? b.text : '')).join('\n\n')
      const thinking = blocks.filter(b => b.type === 'thinking').map(b => (b.type === 'thinking' ? b.text : '')).join('\n\n')
      const laid: LaidCell[] = [{
        absTime: time,
        cell: {
          kind: 'message',
          index: ++index,
          ...(text !== '' ? { text, previewMarkdown: text } : thinking !== '' ? { previewMarkdown: thinking } : {}),
          ...(thinking !== '' ? { thinkingDetail: thinking } : {}),
          ...(u !== null ? {
            input: u.input,
            output: u.output,
            cacheRead: u.cacheRead,
            cacheWrite: u.cacheWrite,
          } : {}),
          timeSeconds: durationSeconds(time, prevAbsTime),
          startedAt: time,
          sourceSeq: row.line,
        },
      }]
      for (const b of blocks) {
        if (b.type !== 'tool_use') continue
        const call = calls.get(b.id)
        const settled = call?.resultTime != null
        laid.push({
          absTime: call?.callTime ?? time,
          toolName: b.name,
          cell: {
            kind: 'tool',
            index: ++index,
            text: b.name,
            previewMarkdown: b.input,
            inputDetail: b.input,
            callId: b.id,
            ...(settled ? { outputDetail: call.resultText ?? '', isError: call.isError } : {}),
            timeSeconds: settled ? durationSeconds(call.resultTime, call.callTime) : null,
            startedAt: call?.callTime ?? time,
            sourceSeq: row.line,
          },
        })
      }
      pushStep(turn, step, laid)
      prevAbsTime = time ?? prevAbsTime
    } else if (row.type === 'summary') {
      const raw = row.raw.summary
      const text = typeof raw === 'string' ? raw : raw === undefined ? 'compacted' : JSON.stringify(raw)
      const turn = lastAssistantTurn === 0 ? 1 : lastAssistantTurn
      pushGroup(turn, `Compaction · line ${row.line}`, [{
        absTime: time,
        cell: {
          kind: 'compacted',
          index: ++index,
          text,
          previewMarkdown: text,
          timeSeconds: durationSeconds(time, prevAbsTime),
          startedAt: time,
          sourceSeq: row.line,
        },
      }])
      prevAbsTime = time ?? prevAbsTime
    } else if (row.type === 'system' && row.subtype === 'init') {
      const model = initModel ?? 'unknown model'
      pushMessage(1, [{
        absTime: time,
        cell: {
          kind: 'system',
          index: ++index,
          text: `session initialized · ${model}`,
          sourceSeq: row.line,
          timeSeconds: 0,
          startedAt: time,
        },
      }])
      prevAbsTime = time ?? prevAbsTime
    }
    // All other rows (queue-operation, mode, file-history, …) advance the
    // duration cursor but produce no cell.
    if (row.type !== 'user' && row.type !== 'assistant' && row.type !== 'summary') {
      if (time !== null) prevAbsTime = time
    }
  }

  // Orphan tool results (no assistant call recorded) fold into turn 1's Step 1.
  for (const [callId, res] of results) {
    if (calls.has(callId)) continue
    pushStep(0, 1, [{
      absTime: res.time,
      toolName: undefined,
      cell: {
        kind: 'tool',
        index: ++index,
        text: '',
        previewMarkdown: res.text,
        outputDetail: res.text,
        callId,
        isError: res.isError,
        timeSeconds: null,
        startedAt: res.time,
        sourceSeq: -1,
      },
    }])
  }

  // Orphan turn-0 cells fold into turn 1 (DSH prologue rule).
  const prologue = turns.get(0)
  if (prologue !== undefined) {
    turns.delete(0)
    const first = turns.get(1) ?? bucket(1)
    first.groups = [...prologue.groups, ...first.groups]
    turns.set(1, first)
  }

  /* ---------- Meta + groups -------------------------------------------------- */
  const tokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (const u of usageRows) {
    tokens.input += u.tokens.input
    tokens.output += u.tokens.output
    tokens.cacheRead += u.tokens.cacheRead
    tokens.cacheWrite += u.tokens.cacheWrite
  }
  const model = firstModel ?? initModel
  const files = new Set<string>()
  const toolCounts: Record<string, number> = {}
  for (const call of calls.values()) {
    toolCounts[call.name] = (toolCounts[call.name] ?? 0) + 1
    for (const p of editPaths(call.name, call.input)) files.add(p)
  }
  const times = rows.map(rowTime).filter((t): t is number => t !== null)
  const startedAt = times.length > 0 ? Math.min(...times) : null
  const endedAt = times.length > 0 ? Math.max(...times) : null

  const meta: SessionMeta = {
    sessionId: opts.sessionId ?? rows.find(r => r.sessionId !== null)?.sessionId
      ?? rows.find(r => r.uuid !== null)?.uuid
      ?? 'unknown',
    projectDir: opts.projectDir ?? initCwd ?? topCwd ?? '',
    filePath: opts.filePath ?? '',
    title: aiTitle ?? (firstUserText === null ? 'Untitled' : firstLineOf(firstUserText, 120)),
    model,
    ccVersion: initVersion,
    mode,
    gitBranch,
    startedAt,
    endedAt,
    lineCount: rows.length,
    isSubagent: opts.isSubagent ?? parentUuid !== null,
    parentSessionId: parentUuid,
    tokens,
    costCents: costCents(tokens, model),
    files: [...files],
    toolCounts,
  }

  const finalTurns: TrajectoryTurn[] = [...turns.entries()]
    .map(([turn, entry]) => {
      const groups = entry.groups.map(({ title, laid }) => {
        const cells = laid.map(l => l.cell)
        const description = groupDescription(laid)
        return description === undefined ? { title, cells } : { title, description, cells }
      })
      return { turn, groups }
    })
    .sort((l, r) => firstCellIndex(l) - firstCellIndex(r))

  const usage: UsagePoint[] = usageRows.map(u => ({
    turn: u.turn,
    step: u.step,
    time: u.time,
    ...u.tokens,
    costCents: costCents(u.tokens, u.model ?? model),
  }))

  return { meta, turns: finalTurns, agents: [], usage }
}

function firstCellIndex(turn: TrajectoryTurn): number {
  let min = Number.POSITIVE_INFINITY
  for (const group of turn.groups) {
    for (const cell of group.cells) if (cell.index < min) min = cell.index
  }
  return min
}

/** Wall-span duration + tool histogram, e.g. `1.5s bash×6` (DSH-style). */
function groupDescription(laid: readonly LaidCell[]): string | undefined {
  const parts: string[] = []
  const times: number[] = []
  for (const l of laid) {
    if (l.absTime !== null && Number.isFinite(l.absTime)) {
      times.push(l.absTime)
      if (l.cell.timeSeconds !== null && Number.isFinite(l.cell.timeSeconds)) {
        times.push(l.absTime + l.cell.timeSeconds * 1000)
      }
    }
  }
  if (times.length >= 2) {
    const span = (Math.max(...times) - Math.min(...times)) / 1000
    if (span > 0) parts.push(formatSeconds(span))
  } else if (times.length === 1) {
    const own = laid.find(l => l.absTime === times[0])?.cell.timeSeconds
    if (own !== null && own !== undefined && own > 0) parts.push(formatSeconds(own))
  }
  const tools = new Map<string, number>()
  for (const l of laid) {
    if (l.toolName === undefined || l.cell.kind !== 'tool') continue
    tools.set(l.toolName, (tools.get(l.toolName) ?? 0) + 1)
  }
  for (const [name, count] of tools) {
    parts.push(count > 1 ? `${name}×${count}` : name)
  }
  return parts.length === 0 ? undefined : parts.join(' ')
}
