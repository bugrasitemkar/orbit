/**
 * REST API + static web serving.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { streamSSE } from 'hono/streaming'
import { foldSession } from '@orbit/trajectory'
import { zipSync } from 'fflate'
import type { Database } from 'bun:sqlite'
import {
  LIVE_WINDOW_MS,
  childSessions,
  getSession,
  globalStats,
  listProjects,
  listSessionLines,
  search,
  updateSessionTitle,
  type SessionRow,
} from './db.ts'
import { rowsFromLines } from './indexer.ts'
import { deriveAgents } from './agents.ts'
import { subscribe } from './events.ts'
import { toHtml, toMarkdown } from './exporters.ts'

interface AppEnv {
  Variables: {
    db: Database
  }
}

function sessionJson(s: SessionRow, liveThreshold: number) {
  return {
    id: s.id,
    projectId: s.project_id,
    title: s.title,
    model: s.model,
    ccVersion: s.cc_version,
    mode: s.mode,
    gitBranch: s.git_branch,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    lineCount: s.line_count,
    live: s.file_mtime > liveThreshold,
    isSubagent: s.is_subagent === 1,
    parentSessionId: s.parent_session_id,
    tokens: {
      input: s.input_tokens,
      output: s.output_tokens,
      cacheRead: s.cache_read_tokens,
      cacheWrite: s.cache_write_tokens,
    },
    costCents: s.cost_cents,
  }
}

export function createApp(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    await next()
  })

  app.get('/healthz', c => c.json({ ok: true }))

  app.get('/api/projects', c => c.json(listProjects(c.get('db'))))

  app.get('/api/sessions', c => {
    const dbx = c.get('db')
    const project = c.req.query('project')
    const q = c.req.query('q')
    const liveOnly = c.req.query('live') === '1'
    const now = Date.now()
    const liveThreshold = now - LIVE_WINDOW_MS
    let sql = `
      SELECT s.*, p.name AS project_name
      FROM sessions s JOIN projects p ON p.id = s.project_id
      WHERE s.is_subagent = 0
    `
    const params: (string | number)[] = []
    if (project !== undefined && project !== '') {
      sql += ' AND p.id = ?'
      params.push(Number(project))
    }
    if (q !== undefined && q !== '') {
      sql += ' AND s.title LIKE ?'
      params.push(`%${q}%`)
    }
    if (liveOnly) {
      sql += ' AND s.file_mtime > ?'
      params.push(liveThreshold)
    }
    sql += ' ORDER BY s.started_at DESC LIMIT 200'
    const rows = dbx.query(sql).all(...params) as (SessionRow & { project_name: string })[]
    return c.json({
      sessions: rows.map(s => ({
        ...sessionJson(s, liveThreshold),
        projectName: s.project_name,
        subagentCount: childSessions(dbx, s.id).length,
      })),
    })
  })

  app.get('/api/sessions/:id', c => {
    const dbx = c.get('db')
    const session = getSession(dbx, c.req.param('id'))
    if (session === null) return c.json({ error: 'not found' }, 404)
    const lines = listSessionLines(dbx, session.id)
    const folded = foldSession(rowsFromLines(lines), {
      sessionId: session.id,
      filePath: session.file_path,
      isSubagent: session.is_subagent === 1,
    })
    // Patch meta with user-editable title and derive the agent graph.
    folded.meta.title = session.title
    folded.meta.filePath = session.file_path
    folded.agents = deriveAgents(dbx, session, lines)
    return c.json({
      meta: sessionJson(session, Date.now() - LIVE_WINDOW_MS),
      trajectory: folded,
    })
  })

  app.get('/api/sessions/:id/usage', c => {
    const dbx = c.get('db')
    const session = getSession(dbx, c.req.param('id'))
    if (session === null) return c.json({ error: 'not found' }, 404)
    const folded = foldSession(rowsFromLines(listSessionLines(dbx, session.id)), { sessionId: session.id })
    return c.json(folded.usage)
  })

  // Per-file edit hunks for the diff view.
  app.get('/api/sessions/:id/files', c => {
    const dbx = c.get('db')
    const session = getSession(dbx, c.req.param('id'))
    if (session === null) return c.json({ error: 'not found' }, 404)
    const calls = dbx.query(`
      SELECT seq, started_at, name, input_json FROM tool_calls
      WHERE session_id = ? AND name IN ('Edit', 'MultiEdit', 'Write', 'NotebookEdit')
      ORDER BY seq
    `).all(session.id) as { seq: number; started_at: number | null; name: string; input_json: string }[]

    interface Hunk { seq: number; time: number | null; tool: string; old: string | null; new: string | null }
    const byPath = new Map<string, Hunk[]>()
    const push = (path: string, hunk: Hunk) => {
      const list = byPath.get(path) ?? []
      list.push(hunk)
      byPath.set(path, list)
    }
    const MAX = 20_000
    const cap = (s: string): string => (s.length > MAX ? `${s.slice(0, MAX)}\n… (truncated)` : s)

    for (const call of calls) {
      let input: Record<string, unknown>
      try {
        input = JSON.parse(call.input_json) as Record<string, unknown>
      } catch {
        continue
      }
      const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
      if (call.name === 'MultiEdit') {
        const edits = Array.isArray(input.edits) ? input.edits : []
        const topPath = str(input.file_path)
        for (const edit of edits) {
          if (typeof edit !== 'object' || edit === null) continue
          const rec = edit as Record<string, unknown>
          const path = str(rec.file_path) ?? topPath
          const oldS = str(rec.old_string)
          const newS = str(rec.new_string)
          if (path !== null && (oldS !== null || newS !== null)) {
            push(path, { seq: call.seq, time: call.started_at, tool: call.name, old: oldS, new: newS })
          }
        }
      } else if (call.name === 'Write') {
        const path = str(input.file_path)
        const content = str(input.content)
        if (path !== null && content !== null) {
          push(path, { seq: call.seq, time: call.started_at, tool: call.name, old: null, new: cap(content) })
        }
      } else {
        // Edit / NotebookEdit
        const path = str(input.file_path)
        const oldS = str(input.old_string)
        const newS = str(input.new_string)
        if (path !== null && (oldS !== null || newS !== null)) {
          push(path, { seq: call.seq, time: call.started_at, tool: call.name, old: oldS, new: newS })
        }
      }
    }
    const files = [...byPath.entries()]
      .map(([path, edits]) => ({ path, edits: edits.sort((a, b) => a.seq - b.seq) }))
      .sort((a, b) => (a.edits[0]?.seq ?? 0) - (b.edits[0]?.seq ?? 0))
    return c.json({ files })
  })

  app.get('/api/search', c => {
    const q = c.req.query('q') ?? ''
    return c.json({ hits: search(c.get('db'), q) })
  })

  app.get('/api/stats', c => {
    return c.json(globalStats(c.get('db'), Date.now() - LIVE_WINDOW_MS))
  })

  app.patch('/api/sessions/:id', async c => {
    const dbx = c.get('db')
    const session = getSession(dbx, c.req.param('id'))
    if (session === null) return c.json({ error: 'not found' }, 404)
    const body = await c.req.json().catch(() => null)
    if (body !== null && typeof body.title === 'string' && body.title.trim() !== '') {
      updateSessionTitle(dbx, session.id, body.title.trim().slice(0, 200), Date.now())
    }
    return c.json({ ok: true })
  })

  app.get('/api/sessions/:id/export', c => {
    const dbx = c.get('db')
    const session = getSession(dbx, c.req.param('id'))
    if (session === null) return c.json({ error: 'not found' }, 404)
    const format = c.req.query('format') ?? 'html'
    const folded = foldSession(rowsFromLines(listSessionLines(dbx, session.id)), {
      sessionId: session.id,
      filePath: session.file_path,
      isSubagent: session.is_subagent === 1,
    })
    folded.meta.title = session.title
    let body: string
    let ext: string
    let contentType: string
    if (format === 'md') {
      body = toMarkdown(folded); ext = 'md'; contentType = 'text/markdown; charset=utf-8'
    } else if (format === 'json') {
      body = JSON.stringify({ meta: sessionJson(session, 0), trajectory: folded }, null, 2)
      ext = 'json'; contentType = 'application/json; charset=utf-8'
    } else {
      body = toHtml(folded); ext = 'html'; contentType = 'text/html; charset=utf-8'
    }
    return new Response(body, {
      headers: {
        'content-type': contentType,
        'content-disposition': `attachment; filename="orbit-${session.id}.${ext}"`,
      },
    })
  })

  app.get('/api/sessions/:id/export/raw', async c => {
    const dbx = c.get('db')
    const session = getSession(dbx, c.req.param('id'))
    if (session === null) return c.json({ error: 'not found' }, 404)
    const files = [
      { name: `${session.id}.jsonl`, path: session.file_path },
      ...childSessions(dbx, session.id).map(child => ({
        name: `subagents/${child.id}.jsonl`,
        path: child.file_path,
      })),
    ].filter(f => existsSync(f.path))
    if (files.length === 0) return c.json({ error: 'no transcript files found on disk' }, 404)

    if (files.length === 1) {
      const buf = await readFile(files[0].path)
      return new Response(buf, {
        headers: {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'content-disposition': `attachment; filename="${files[0].name}"`,
        },
      })
    }

    const entries: Record<string, Uint8Array> = {}
    for (const f of files) entries[f.name] = await readFile(f.path)
    const zipped = zipSync(entries)
    return new Response(zipped, {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="orbit-${session.id}-transcripts.zip"`,
      },
    })
  })

  app.post('/api/sessions/:id/resume', c => {
    const dbx = c.get('db')
    const session = getSession(dbx, c.req.param('id'))
    if (session === null) return c.json({ error: 'not found' }, 404)
    const project = dbx.query<{ name: string }, [number]>(
      'SELECT name FROM projects WHERE id = ?',
    ).get(session.project_id)
    const cwd = project?.name ?? null
    if (cwd === null || !/^[A-Za-z]:[\\/]/.test(cwd)) {
      return c.json({ error: 'project directory unknown for this session' }, 400)
    }
    try {
      Bun.spawn(['cmd', '/c', 'start', '', 'claude', '--resume', session.id], {
        cwd,
        stdio: ['ignore', 'ignore', 'ignore'],
        detached: true,
      })
    } catch {
      return c.json({ error: 'failed to launch claude' }, 500)
    }
    return c.json({ ok: true, cwd })
  })

  // SSE live feed: indexer publishes session-updated events here.
  app.get('/api/events', c => streamSSE(c, async stream => {
    const unsubscribe = subscribe(event => {
      void stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
    })
    stream.onAbort(() => {
      unsubscribe()
    })
    // Heartbeat every 5s: keeps proxies and idle-timeout layers from
    // reaping the connection between real events.
    while (true) {
      await stream.sleep(5_000)
      await stream.writeSSE({ event: 'ping', data: '{}' })
    }
  }))

  // Static web app (built) with SPA fallback.
  const webDist = join(import.meta.dir, '../../web/dist')
  app.use('*', serveStatic({ root: webDist }))
  app.get('*', c => {
    const index = join(webDist, 'index.html')
    if (existsSync(index)) return new Response(Bun.file(index))
    return c.text('Orbit server running. Build the web app (pnpm build) or use the Vite dev server at :5173.')
  })

  return app
}
