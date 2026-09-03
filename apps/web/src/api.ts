import type { TrajectorySession, UsagePoint } from '@orbit/trajectory'

export interface TokenSet {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
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

export interface SessionSummary {
  id: string
  projectId: number
  projectName: string
  title: string
  model: string | null
  ccVersion: string | null
  mode: string | null
  gitBranch: string | null
  startedAt: number | null
  endedAt: number | null
  lineCount: number
  live: boolean
  isSubagent: boolean
  parentSessionId: string | null
  tokens: TokenSet
  costCents: number | null
  subagentCount: number
}

export interface GlobalStats {
  projects: number
  sessions: number
  live: number
  input_tokens: number
  output_tokens: number
  cost_cents: number | null
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

export interface FileHunk {
  seq: number
  time: number | null
  tool: string
  old: string | null
  new: string | null
}

export interface SessionFile {
  path: string
  edits: FileHunk[]
}

export interface SessionDetail {
  meta: SessionSummary
  trajectory: TrajectorySession
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`request failed: ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  projects: () => getJson<ProjectRollup[]>('/api/projects'),
  sessions: (projectId?: number | null, q?: string) => {
    const params = new URLSearchParams()
    if (projectId != null) params.set('project', String(projectId))
    if (q) params.set('q', q)
    const qs = params.toString()
    return getJson<{ sessions: SessionSummary[] }>(`/api/sessions${qs === '' ? '' : `?${qs}`}`)
  },
  session: (id: string) => getJson<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`),
  usage: (id: string) => getJson<UsagePoint[]>(`/api/sessions/${encodeURIComponent(id)}/usage`),
  files: (id: string) => getJson<{ files: SessionFile[] }>(`/api/sessions/${encodeURIComponent(id)}/files`),
  stats: () => getJson<GlobalStats>('/api/stats'),
  search: (q: string) => getJson<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  exportUrl: (id: string, format: 'html' | 'md' | 'json') =>
    `/api/sessions/${encodeURIComponent(id)}/export?format=${format}`,
  resume: async (id: string): Promise<{ ok: boolean; error?: string }> => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/resume`, { method: 'POST' })
    return res.json() as Promise<{ ok: boolean; error?: string }>
  },
}
