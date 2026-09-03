/**
 * Indexer: walks ~/.claude/projects for *.jsonl transcripts, folds each into
 * the trajectory model, and stores it in SQLite. Chokidar keeps the index
 * live; incremental work is keyed on (path, mtime, size).
 */
import type { Database } from 'bun:sqlite'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { foldSession, messageBlocks, parseLine, parseSessionFile, rowTime } from '@orbit/trajectory'
import {
  deleteFileStamp,
  deleteSessionByPath,
  getFileStamp,
  replaceSession,
  setFileStamp,
  upsertProject,
  type IndexedSession,
  type SessionRow,
} from './db.ts'
import { publish } from './events.ts'

export function defaultClaudeDir(): string {
  return process.env.ORBIT_CLAUDE_DIR ?? join(homedir(), '.claude', 'projects')
}

function isJsonl(path: string): boolean {
  return path.toLowerCase().endsWith('.jsonl')
}

/** Encoded project dir of a transcript: 3 levels up for subagent files. */
function projectDirOf(filePath: string): string {
  if (filePath.split(sep).includes('subagents')) {
    return dirname(dirname(dirname(filePath)))
  }
  return dirname(filePath)
}

function isSubagentPath(filePath: string): boolean {
  return filePath.split(sep).includes('subagents')
}

/** Parent session id of a subagent transcript: the enclosing <uuid> folder
 *  (rows' parentUuid is a message id, not the session id). */
function parentSessionOf(filePath: string): string | null {
  if (!isSubagentPath(filePath)) return null
  return basename(dirname(dirname(filePath)))
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && isJsonl(entry.name)) out.push(full)
    }
  }
  await walk(root)
  return out
}

/** Parse rows back from stored lines (same shapes as the live parse). */
export function rowsFromLines(lines: { seq: number; time: number | null; kind: string; line: string }[]) {
  const rows = []
  for (const entry of lines) {
    const row = parseLine(entry.line, entry.seq)
    if (row !== null) rows.push(row)
  }
  return rows
}

export async function indexFile(db: Database, filePath: string, now: number): Promise<boolean> {
  let stamp
  try {
    stamp = await stat(filePath)
  } catch {
    return false
  }
  const current = getFileStamp(db, filePath)
  if (current !== null && current.mtime === Math.round(stamp.mtimeMs) && current.size === stamp.size) {
    return false
  }
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch {
    return false
  }
  const parsed = parseSessionFile(text)
  if (parsed.length === 0) return false
  const sessionId = basename(filePath, '.jsonl')
  const folded = foldSession(parsed, {
    sessionId,
    filePath,
    isSubagent: isSubagentPath(filePath),
  })
  const meta = folded.meta
  const projectPath = projectDirOf(filePath)
  const projectId = upsertProject(
    db,
    projectPath,
    meta.projectDir !== '' && meta.projectDir !== null ? meta.projectDir : projectPath,
    now,
  )
  const mtime = Math.round(stamp.mtimeMs)

  const session: SessionRow = {
    id: sessionId,
    project_id: projectId,
    file_path: filePath,
    parent_session_id: parentSessionOf(filePath),
    is_subagent: meta.isSubagent ? 1 : 0,
    title: meta.title,
    model: meta.model,
    cc_version: meta.ccVersion,
    mode: meta.mode,
    git_branch: meta.gitBranch,
    started_at: meta.startedAt,
    ended_at: meta.endedAt,
    line_count: meta.lineCount,
    file_mtime: mtime,
    file_size: stamp.size,
    input_tokens: meta.tokens.input,
    output_tokens: meta.tokens.output,
    cache_read_tokens: meta.tokens.cacheRead,
    cache_write_tokens: meta.tokens.cacheWrite,
    cost_cents: meta.costCents,
    updated_at: now,
  }

  // Derive tool-call rows from the folded cells (call + result pairing).
  const toolCalls: IndexedSession['toolCalls'] = []
  const seen = new Set<string>()
  const rows: IndexedSession['rows'] = parsed.map(row => ({
    seq: row.line,
    time: rowTime(row),
    kind: row.type,
    line: JSON.stringify(row.raw),
  }))
  const fts: IndexedSession['fts'] = []
  const calls = new Map<string, { name: string; input: string; start: number | null; seq: number }>()
  const results = new Map<string, { text: string; isError: boolean; end: number | null }>()

  for (const row of parsed) {
    const blocks = messageBlocks(row)
    const time = rowTime(row)
    for (const b of blocks) {
      if (b.type === 'tool_use') calls.set(b.id, { name: b.name, input: b.input, start: time, seq: row.line })
      if (b.type === 'tool_result') results.set(b.toolUseId, { text: b.text, isError: b.isError, end: time })
    }
  }
  for (const [callId, call] of calls) {
    const res = results.get(callId)
    const start = call.start
    const end = res?.end ?? null
    seen.add(callId)
    toolCalls.push({
      callId,
      seq: call.seq,
      name: call.name,
      startedAt: start,
      endedAt: end,
      durationMs: start !== null && end !== null ? Math.max(0, end - start) : null,
      status: res === undefined ? 'running' : res.isError ? 'error' : 'ok',
      inputJson: call.input,
      outputText: res?.text ?? null,
      isError: res?.isError ?? false,
    })
  }
  for (const [callId, res] of results) {
    if (seen.has(callId)) continue
    toolCalls.push({
      callId,
      seq: 0,
      name: '(orphan result)',
      startedAt: null,
      endedAt: res.end,
      durationMs: null,
      status: res.isError ? 'error' : 'ok',
      inputJson: '',
      outputText: res.text,
      isError: res.isError,
    })
  }
  for (const row of parsed) {
    const blocks = messageBlocks(row)
    const texts: string[] = []
    for (const b of blocks) {
      if (b.type === 'text') texts.push(b.text)
      if (b.type === 'tool_result' && b.text !== '') texts.push(b.text)
    }
    if (row.type === 'summary' && typeof row.raw.summary === 'string') texts.push(row.raw.summary)
    const content = texts.join('\n').trim()
    if (content !== '') fts.push({ seq: row.line, kind: row.type, content })
  }

  replaceSession(db, session, { meta: folded.meta, rows, toolCalls, fts })
  setFileStamp(db, filePath, { mtime, size: stamp.size })
  publish({
    type: 'session-updated',
    sessionId,
    title: meta.title,
  })
  return true
}

/** One full scan of the tree; returns the number of files indexed. */
export async function scanAll(db: Database, root: string): Promise<number> {
  const files = await listJsonlFiles(root)
  let count = 0
  for (const file of files) {
    if (await indexFile(db, file, Date.now())) count++
  }
  return count
}

const pending = new Map<string, ReturnType<typeof setTimeout>>()

function schedule(db: Database, filePath: string, delayMs = 800): void {
  const existing = pending.get(filePath)
  if (existing !== undefined) clearTimeout(existing)
  pending.set(filePath, setTimeout(() => {
    pending.delete(filePath)
    void indexFile(db, filePath, Date.now())
  }, delayMs))
}

export function startWatcher(db: Database, root: string): FSWatcher {
  const watcher = watch(root, {
    ignoreInitial: true,
    depth: 8,
    // Ignore only non-jsonl FILES — directories must stay traversable.
    ignored: (path: string, stats?: { isFile?: () => boolean }) =>
      stats?.isFile?.() === true && !isJsonl(path),
  })
  watcher.on('add', (path: string) => schedule(db, path, 300))
  watcher.on('change', (path: string) => schedule(db, path))
  watcher.on('unlink', (path: string) => {
    deleteSessionByPath(db, path)
    deleteFileStamp(db, path)
  })
  return watcher
}
