/**
 * SQLite schema + accessors (bun:sqlite). The DB is a derived index; the
 * JSONL files remain the source of truth.
 */
import { Database } from 'bun:sqlite'

export interface SessionRow {
  id: string
  project_id: number
  file_path: string
  parent_session_id: string | null
  is_subagent: number
  title: string
  model: string | null
  cc_version: string | null
  mode: string | null
  git_branch: string | null
  started_at: number | null
  ended_at: number | null
  line_count: number
  file_mtime: number
  file_size: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_cents: number | null
  updated_at: number
}

export interface FileStamp {
  mtime: number
  size: number
}

export function openDb(path: string): Database {
  return new Database(path, { create: true })
}

export function initSchema(db: Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      file_path TEXT UNIQUE NOT NULL,
      parent_session_id TEXT,
      is_subagent INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      model TEXT, cc_version TEXT, mode TEXT, git_branch TEXT,
      started_at INTEGER, ended_at INTEGER, line_count INTEGER NOT NULL DEFAULT 0,
      file_mtime INTEGER NOT NULL, file_size INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cost_cents INTEGER, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
    CREATE TABLE IF NOT EXISTS rows (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      time INTEGER,
      kind TEXT NOT NULL,
      line TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rows_session ON rows(session_id, seq);
    CREATE TABLE IF NOT EXISTS tool_calls (
      call_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      name TEXT NOT NULL,
      started_at INTEGER, ended_at INTEGER, duration_ms INTEGER,
      status TEXT NOT NULL,
      input_json TEXT, output_text TEXT, is_error INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (call_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
      session_id UNINDEXED, seq UNINDEXED, kind UNINDEXED, content
    );
  `)
}

export function getFileStamp(db: Database, path: string): FileStamp | null {
  return db.query<FileStamp, [string]>('SELECT mtime, size FROM files WHERE path = ?').get(path) ?? null
}

export function setFileStamp(db: Database, path: string, stamp: FileStamp): void {
  db.query('INSERT INTO files (path, mtime, size) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size')
    .run(path, stamp.mtime, stamp.size)
}

export function deleteFileStamp(db: Database, path: string): void {
  db.query('DELETE FROM files WHERE path = ?').run(path)
}

export function upsertProject(db: Database, path: string, name: string, now: number): number {
  db.query('INSERT INTO projects (path, name, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at')
    .run(path, name, now)
  const row = db.query<{ id: number }, [string]>('SELECT id FROM projects WHERE path = ?').get(path)
  return row?.id ?? -1
}

export interface IndexedSession {
  meta: {
    sessionId: string
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
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
    costCents: number | null
  }
  rows: { seq: number; time: number | null; kind: string; line: string }[]
  toolCalls: {
    callId: string
    seq: number
    name: string
    startedAt: number | null
    endedAt: number | null
    durationMs: number | null
    status: string
    inputJson: string
    outputText: string | null
    isError: boolean
  }[]
  fts: { seq: number; kind: string; content: string }[]
}

const replaceSessionTx = (db: Database) =>
  db.transaction((s: SessionRow, data: IndexedSession) => {
    // Sessions are keyed by both id (PK) and file_path; clear any row that
    // matches either before inserting.
    db.query('DELETE FROM sessions WHERE id = ? OR file_path = ?').run(s.id, s.file_path)
    db.query(`
      INSERT INTO sessions (id, project_id, file_path, parent_session_id, is_subagent,
        title, model, cc_version, mode, git_branch, started_at, ended_at, line_count,
        file_mtime, file_size, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, cost_cents, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      s.id, s.project_id, s.file_path, s.parent_session_id, s.is_subagent,
      s.title, s.model, s.cc_version, s.mode, s.git_branch,
      s.started_at, s.ended_at, s.line_count, s.file_mtime, s.file_size,
      s.input_tokens, s.output_tokens, s.cache_read_tokens, s.cache_write_tokens,
      s.cost_cents, s.updated_at,
    )
    const sid = s.id
    db.query('DELETE FROM rows WHERE session_id = ?').run(sid)
    db.query('DELETE FROM tool_calls WHERE session_id = ?').run(sid)
    db.query('DELETE FROM fts WHERE session_id = ?').run(sid)
    const insertRow = db.query('INSERT INTO rows (session_id, seq, time, kind, line) VALUES (?, ?, ?, ?, ?)')
    const insertCall = db.query(`INSERT INTO tool_calls (call_id, session_id, seq, name, started_at, ended_at, duration_ms, status, input_json, output_text, is_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const insertFts = db.query('INSERT INTO fts (session_id, seq, kind, content) VALUES (?, ?, ?, ?)')
    for (const row of data.rows) insertRow.run(sid, row.seq, row.time, row.kind, row.line)
    for (const call of data.toolCalls) {
      insertCall.run(call.callId, sid, call.seq, call.name, call.startedAt, call.endedAt, call.durationMs, call.status, call.inputJson, call.outputText, call.isError ? 1 : 0)
    }
    for (const entry of data.fts) insertFts.run(sid, entry.seq, entry.kind, entry.content)
  })

export function replaceSession(
  db: Database,
  session: SessionRow,
  data: IndexedSession,
): void {
  replaceSessionTx(db)(session, data)
}

export function deleteSessionByPath(db: Database, path: string): void {
  const row = db.query<{ id: string }, [string]>('SELECT id FROM sessions WHERE file_path = ?').get(path)
  if (row === null) return
  db.transaction((id: string) => {
    db.query('DELETE FROM rows WHERE session_id = ?').run(id)
    db.query('DELETE FROM tool_calls WHERE session_id = ?').run(id)
    db.query('DELETE FROM fts WHERE session_id = ?').run(id)
    db.query('DELETE FROM sessions WHERE id = ?').run(id)
  })(row.id)
}

export function getSession(db: Database, id: string): SessionRow | null {
  return db.query<SessionRow, [string]>('SELECT * FROM sessions WHERE id = ?').get(id) ?? null
}

export function listSessionLines(db: Database, id: string): { seq: number; time: number | null; kind: string; line: string }[] {
  return db.query('SELECT seq, time, kind, line FROM rows WHERE session_id = ? ORDER BY seq').all(id) as never
}

export function childSessions(db: Database, parentId: string): SessionRow[] {
  return db.query('SELECT * FROM sessions WHERE parent_session_id = ? ORDER BY started_at').all(parentId) as never
}

export function updateSessionTitle(db: Database, id: string, title: string, now: number): void {
  db.query('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, now, id)
}

export interface SearchHit {
  session_id: string
  project_id: number
  title: string
  project_name: string
  seq: number
  kind: string
  snippet: string
}

export function search(db: Database, query: string): SearchHit[] {
  // FTS5 syntax: strip characters that have query meaning.
  const q = query.replace(/["*:^()]/g, ' ').trim().split(/\s+/).filter(Boolean).join(' AND ')
  if (q === '') return []
  return db.query<SearchHit, [string]>(`
    SELECT f.session_id, p.id AS project_id, s.title, p.name AS project_name,
           f.seq, f.kind,
           snippet(fts, 1, '⟦', '⟧', '…', 16) AS snippet
    FROM fts f
    JOIN sessions s ON s.id = f.session_id
    JOIN projects p ON p.id = s.project_id
    WHERE fts MATCH ?
    ORDER BY rank
    LIMIT 50
  `).all(q) as never
}

export interface ProjectRollup {
  id: number
  path: string
  name: string
  session_count: number
  input_tokens: number
  output_tokens: number
  cost_cents: number | null
  last_activity: number | null
}

export function listProjects(db: Database): ProjectRollup[] {
  return db.query(`
    SELECT p.id, p.path, p.name,
           COUNT(s.id) AS session_count,
           COALESCE(SUM(s.input_tokens), 0) AS input_tokens,
           COALESCE(SUM(s.output_tokens), 0) AS output_tokens,
           SUM(s.cost_cents) AS cost_cents,
           MAX(s.ended_at) AS last_activity
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id AND s.is_subagent = 0
    GROUP BY p.id
    ORDER BY last_activity DESC
  `).all() as never
}

export interface GlobalStats {
  projects: number
  sessions: number
  live: number
  input_tokens: number
  output_tokens: number
  cost_cents: number | null
}

export function globalStats(db: Database, liveThreshold: number): GlobalStats {
  const row = db.query<GlobalStats, [number]>(`
    SELECT
      (SELECT COUNT(*) FROM projects) AS projects,
      (SELECT COUNT(*) FROM sessions WHERE is_subagent = 0) AS sessions,
      (SELECT COUNT(*) FROM sessions WHERE is_subagent = 0 AND file_mtime > ?) AS live,
      (SELECT COALESCE(SUM(input_tokens), 0) FROM sessions WHERE is_subagent = 0) AS input_tokens,
      (SELECT COALESCE(SUM(output_tokens), 0) FROM sessions WHERE is_subagent = 0) AS output_tokens,
      (SELECT SUM(cost_cents) FROM sessions WHERE is_subagent = 0) AS cost_cents
  `).get(liveThreshold)
  return row ?? { projects: 0, sessions: 0, live: 0, input_tokens: 0, output_tokens: 0, cost_cents: null }
}

export const LIVE_WINDOW_MS = 30_000
