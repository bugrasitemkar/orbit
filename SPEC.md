# Orbit — SPEC

Local-first Claude Code trajectory viewer. Reads Claude Code session transcripts
(`~/.claude/projects/**/*.jsonl`), indexes them, and renders each session as a
**trajectory** — turns, steps, tool calls, timing, tokens — in a dark-neon web UI.

Single machine, read-only over the source logs, no outbound network.

## Source of truth

Claude Code writes one JSONL file per session:

```
~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl                main transcript
~/.claude/projects/<encoded-cwd>/<session-uuid>/subagents/*.jsonl    subagent transcripts
```

One JSON object per line. Recognized row shapes (format is undocumented and
shifts between CC versions — parsing is defensive, unknown fields/rows are
retained or skipped, never fatal):

| Row type | Payload of interest |
|---|---|
| `user` | `message.content[]` blocks: `text` (human prompt) or `tool_result` (`tool_use_id`, `content`, `is_error`) |
| `assistant` | `message.content[]` blocks: `text`, `thinking`, `tool_use` (`id`, `name`, `input`); `message.usage` (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`); `message.model`, `message.id` |
| `system` | `subtype`: `init` (model, cwd, tools, version), `mode`, `queue-operation`, … |
| `summary` | compaction summary text |
| other | `file-history-*`, etc. — recorded, not folded |

Subagent transcripts are separate files whose rows carry `parentUuid` pointing at
the owning session.

## Alignment with DSH trajectories

Orbit mirrors the DSH trajectory architecture (see the DSH agent-notes in the
deepseek-harness checkout: `2026-07-23-trajectory-step-cell`,
`2026-07-27-trajectory-inspection-ledger`,
`2026-08-11-trajectory-conversation-context-assembly`) adapted to a different raw
event source:

1. **Durable events → business fold → view model.** DSH folds a session event
   window into `Turns → Groups → Cells`. Orbit does the same fold over parsed
   Claude rows.
2. **Cell kinds.** `user`, `message`, `tool`, `subtool`, `system`, `compacted`,
   `context` (reserved). A `tool` cell folds one `tool_use` + its paired
   `tool_result` by `callId`; `subtool` nests under its parent tool.
3. **Own-duration time column.** Message duration = row time − previous surface
   time; tool duration = result time − call time; in-flight cells show `—`.
4. **Token columns on Message cells.** `input / output / cache-read /
   cache-write` (+ `think`, reserved — Claude rows don't report reasoning
   tokens).
5. **Group descriptions.** Wall-span + tool histogram, e.g. `1.5s bash×6`.
6. **Turn enclosure.** A `user` row has no turn on the wire; it is enclosed in
   the *next* assistant's turn (else in-flight turn, else last+1).
7. **Orphan tools** (result without a recorded call) fold into turn 1.
8. **Requests/steps.** Each assistant row within a turn is one step; tool
   cells join the step of the assistant that issued them.
9. **Compaction.** `summary` rows become `compacted` cells in their turn.
10. **Inspector.** Selected cell shows raw input/output JSON, tool schema
    (reserved), timing, provenance.
11. **Search index** over message text, updated incrementally.

## Canonical model (`packages/trajectory`)

```ts
// Raw, defensive
type ClaudeRow = { line: number; type: string; subtype?: string;
  timestamp: string | null; uuid: string | null; parentUuid: string | null;
  sessionId: string | null; raw: unknown }

// Session facts
interface SessionMeta {
  sessionId: string; projectDir: string; filePath: string;
  title: string;            // derived: first user text
  model: string | null; ccVersion: string | null; mode: string | null;
  gitBranch: string | null; startedAt: number | null; endedAt: number | null;
  lineCount: number; isSubagent: boolean; parentSessionId: string | null;
  tokens: { input; output; cacheRead; cacheWrite };
  costCents: number | null; // null when model unpriced
  files: string[];          // paths touched by Edit/MultiEdit/Write/NotebookEdit
  toolCounts: Record<string, number>;
}

// Folded view model
interface TrajectoryCell { kind: CellKind; index: number; text?: string;
  previewMarkdown?: string; inputDetail?: string; outputDetail?: string;
  thinkingDetail?: string; callId?: string; isError?: boolean;
  timeSeconds: number | null; startedAt: number | null;
  input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
  think?: number; subCalls?: TrajectoryCell[]; requestOnly?: boolean;
  sourceSeq: number }
interface TrajectoryGroup { title: string; description?: string;
  cells: TrajectoryCell[] }
interface TrajectoryTurn { turn: number | null; groups: TrajectoryGroup[] }
interface TrajectorySession { meta: SessionMeta;
  turns: TrajectoryTurn[]; agents: AgentSummary[] }

interface AgentSummary { id: string; label: string; sessionId: string | null;
  model: string | null; toolCount: number; outputTokens: number;
  startedAt: number | null; endedAt: number | null; status: 'running'|'done' }
```

## Storage (SQLite, `data/orbit.db`)

```sql
projects (id INTEGER PK, path TEXT UNIQUE, name TEXT, last_seen_at INTEGER)
sessions (id TEXT PK, project_id INTEGER, file_path TEXT UNIQUE,
  parent_session_id TEXT, is_subagent INTEGER, title TEXT, model TEXT,
  cc_version TEXT, mode TEXT, git_branch TEXT, started_at INTEGER,
  ended_at INTEGER, line_count INTEGER, file_mtime INTEGER, file_size INTEGER,
  input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
  cache_write_tokens INTEGER, cost_cents INTEGER, updated_at INTEGER)
rows (id INTEGER PK, session_id TEXT, seq INTEGER, time INTEGER, kind TEXT,
  json TEXT)                 -- raw row, kept for re-folding
tool_calls (call_id TEXT, session_id TEXT, seq INTEGER, name TEXT,
  started_at INTEGER, ended_at INTEGER, duration_ms INTEGER, status TEXT,
  input_json TEXT, output_text TEXT, is_error INTEGER,
  PRIMARY KEY (call_id, session_id))
fts (session_id TEXT, seq INTEGER, kind TEXT, content TEXT)  -- FTS5 table
files (session_id TEXT, path TEXT, tool TEXT, seq INTEGER,
  PRIMARY KEY (session_id, path))
```

Liveness is computed, not stored: a session is live while
`now − file_mtime < 30s`. Incremental indexing is keyed on `(path, mtime, size)`.

## API (Hono)

```
GET /api/projects                       projects + rollups
GET /api/sessions?project=&q=&live=     session list
GET /api/sessions/:id                   meta + folded turns + agents
GET /api/sessions/:id/usage             per-turn token/cost curve
GET /api/search?q=                      FTS5 over message text
GET /api/stats                          global aggregates
PATCH /api/sessions/:id                 { title }
POST /api/sessions/:id/export?format=   html | md | json   (P3)
GET /api/events                         SSE, live session updates (P2)
GET /healthz
/                                       built web app (dist)
```

## UI (React + Vite + Tailwind, dark neon)

```
┌────────────┬──────────────────────────────────────────┬─────────────┐
│ ◤ ORBIT    │  Timeline │ Graph │ Analytics │ [live ●]  │  Inspector  │
│ PROJECTS   ├──────────────────────────────────────────┤  tool: Edit │
│ ▸ project  │  Turn 1 ▸ 08:12  ● user: "…"              │  duration    │
│   session ●│  ┌─ bash ✓ 1.2s                           │  input/out   │
│   session  │  ├─ Read ✓ 0.3s                           │  ↑ tokens    │
│   session  │  └─ Edit ✗ → retry ✓                      │  agent tree  │
└────────────┴──────────────────────────────────────────┴─────────────┘
```

- **Left rail**: projects → sessions, live dot, model/token/cost chips, search
  (Ctrl+K later).
- **Timeline** (P1): turn bars, groups with wall-span + histogram, cells with
  own-duration column; transcript ⇄ tool-rail toggle; scrubbing playhead.
- **Graph** (P2): main agent + subagents as nodes, animated edges while live.
- **Analytics** (P3): token/cost curve per turn; global dashboard.
- **Inspector** (P1): selected tool call / message detail.
- Theme: base `#0a0a12`, surface `#12121c`, neon cyan `#22d3ee` → violet
  `#a78bfa`, glow on active edges, JetBrains Mono for data, subtle grid
  backdrop, pulsing live indicators. Local-only: system font stack, no CDN.

## Phases

| Phase | Scope | Status |
|---|---|---|
| **P0** | parser, model, fold, SQLite+FTS indexer, watcher, REST API, session browser UI | ✅ verified on 280 real transcripts |
| **P1** | timeline viewer (turns/groups/cells), inspector, transcript ⇄ tool-rail toggle, scrubbing playhead | ✅ done |
| **P2** | agent/sub-agent graph (task-notifications + subagent transcripts), SSE live tailing | ✅ done, live pipeline verified end-to-end |
| **P3** | analytics dashboard (stacked token chart + cost curve), export (HTML/MD/JSON), resume button | ✅ done |
| **P4** | polish: Ctrl+K search palette, file-diff view (Edit/MultiEdit/Write hunks), focus-jump from search | ✅ done; annotations remain reserved (out of MVP) |

## Risks

- **Undocumented JSONL format**: parser must degrade per unknown row/field;
  record CC version per session for diagnosis.
- **Large files**: keep raw rows in SQLite and re-fold per request at P0;
  cache folded JSON later if needed.
- **Privacy**: everything stays local; no telemetry, no CDN assets.
- **Model pricing drift**: pricing table is configurable data, not code.
