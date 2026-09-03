/**
 * Defensive parser for Claude Code JSONL transcripts.
 * The format is undocumented and shifts between CC versions: unknown rows,
 * fields, and malformed lines must degrade instead of failing.
 */
import type { ClaudeRow, ContentBlock } from './model.ts'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asObject(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null
}

export function parseLine(line: string, lineNo: number): ClaudeRow | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return null
  }
  const rec = asObject(raw)
  if (rec === null) return null
  return {
    line: lineNo,
    type: asString(rec.type) ?? 'unknown',
    subtype: asString(rec.subtype),
    timestamp: asString(rec.timestamp),
    uuid: asString(rec.uuid),
    parentUuid: asString(rec.parentUuid),
    sessionId: asString(rec.sessionId),
    raw: rec,
  }
}

export function parseSessionFile(text: string): ClaudeRow[] {
  const rows: ClaudeRow[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const row = parseLine(lines[i] ?? '', i + 1)
    if (row !== null) rows.push(row)
  }
  return rows
}

/** `row.timestamp` as epoch ms; null when absent/unparseable. */
export function rowTime(row: ClaudeRow): number | null {
  if (row.timestamp === null) return null
  const t = Date.parse(row.timestamp)
  return Number.isFinite(t) ? t : null
}

/** Content blocks of a user/assistant row's message. */
export function messageBlocks(row: ClaudeRow): ContentBlock[] {
  const message = asObject(row.raw.message)
  if (message === null) return []
  const content = message.content
  // Real rows carry content as a block array, but early Claude Code versions
  // used a plain string for the first user prompt.
  if (typeof content === 'string') {
    return content === '' ? [] : [{ type: 'text', text: content }]
  }
  if (!Array.isArray(content)) return []
  const out: ContentBlock[] = []
  for (const entry of content) {
    const block = asObject(entry)
    if (block === null) continue
    const type = asString(block.type)
    if (type === 'text') {
      const text = asString(block.text)
      if (text !== null) out.push({ type: 'text', text })
    } else if (type === 'thinking') {
      const text = asString(block.thinking)
      if (text !== null) out.push({ type: 'thinking', text })
    } else if (type === 'tool_use') {
      const id = asString(block.id)
      const name = asString(block.name)
      if (id !== null && name !== null) {
        out.push({
          type: 'tool_use',
          id,
          name,
          input: JSON.stringify(block.input ?? {}),
        })
      }
    } else if (type === 'tool_result') {
      const toolUseId = asString(block.tool_use_id)
      if (toolUseId !== null) {
        let text = ''
        let isError = block.is_error === true
        const inner = block.content
        if (typeof inner === 'string') {
          text = inner
        } else if (Array.isArray(inner)) {
          text = inner
            .filter(b => isRecord(b) && asString(b.type) === 'text')
            .map(b => (isRecord(b) ? (asString(b.text) ?? '') : ''))
            .join('\n')
        }
        out.push({ type: 'tool_result', toolUseId, text, isError })
      }
    } else {
      out.push({ type: 'other', data: block })
    }
  }
  return out
}

/** Usage object of an assistant row; zeros when absent. */
export function usageOf(row: ClaudeRow): {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cacheCreation: number
} | null {
  const message = asObject(row.raw.message)
  if (message === null) return null
  const usage = asObject(message.usage)
  if (usage === null) return null
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0
  return {
    input: num(usage.input_tokens),
    output: num(usage.output_tokens),
    cacheRead: num(usage.cache_read_input_tokens),
    cacheWrite: num(usage.cache_creation_input_tokens),
    // Older rows used `cache_creation` / `cache_read` as objects.
    cacheCreation: num(usage.cache_creation_input_tokens),
  }
}

export function modelOf(row: ClaudeRow): string | null {
  const message = asObject(row.raw.message)
  return message === null ? null : asString(message.model)
}

/** `subtype: init` system rows carry session facts. */
export function initFacts(
  row: ClaudeRow,
): { model: string | null; cwd: string | null; version: string | null } | null {
  if (row.type !== 'system' || row.subtype !== 'init') return null
  return {
    model: asString(row.raw.model),
    cwd: asString(row.raw.cwd),
    version: asString(row.raw.version),
  }
}

/** Claude Code 2.x `ai-title` rows carry an AI-generated session title. */
export function aiTitleOf(row: ClaudeRow): string | null {
  if (row.type !== 'ai-title') return null
  return asString(row.raw.aiTitle)
}

/** Top-level `cwd` field seen on some row types (attachment, etc.). */
export function topLevelCwd(row: ClaudeRow): string | null {
  return asString(row.raw.cwd)
}

/** File paths touched by an edit-family tool input. */
export function editPaths(name: string, inputJson: string): string[] {
  if (name !== 'Edit' && name !== 'MultiEdit' && name !== 'Write' && name !== 'NotebookEdit') {
    return []
  }
  try {
    const input: unknown = JSON.parse(inputJson)
    if (!isRecord(input)) return []
    const paths: string[] = []
    if (typeof input.file_path === 'string') paths.push(input.file_path)
    if (typeof input.path === 'string') paths.push(input.path)
    if (Array.isArray(input.edits)) {
      for (const edit of input.edits) {
        if (isRecord(edit) && typeof edit.file_path === 'string') {
          paths.push(edit.file_path)
        }
      }
    }
    return paths
  } catch {
    return []
  }
}
