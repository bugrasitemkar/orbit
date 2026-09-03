/**
 * Session export renderers: Markdown and self-contained HTML.
 */
import type { TrajectoryCell, TrajectorySession } from '@orbit/trajectory'

const MAX_SNIPPET = 3000

function snippet(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  const t = text.trim()
  if (t.length <= MAX_SNIPPET) return t
  return `${t.slice(0, MAX_SNIPPET)}\n… (truncated)`
}

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function toMarkdown(t: TrajectorySession): string {
  const meta = t.meta
  const out: string[] = []
  out.push(`# ${meta.title}`, '')
  out.push(
    `${meta.model ?? 'unknown model'} · ${meta.projectDir || 'unknown project'} · ` +
    `tokens ${meta.tokens.input.toLocaleString()}→${meta.tokens.output.toLocaleString()} · ` +
    `${meta.costCents === null ? 'cost —' : `$${(meta.costCents / 100).toFixed(2)}`}`,
    '',
  )
  for (const turn of t.turns) {
    out.push(`## Turn ${turn.turn}`, '')
    for (const group of turn.groups) {
      const desc = group.description === undefined ? '' : ` — ${group.description}`
      out.push(`### ${group.title}${desc}`, '')
      for (const cell of group.cells) {
        out.push(cellLine(cell))
      }
      out.push('')
    }
  }
  return out.join('\n')
}

function cellLine(cell: TrajectoryCell): string {
  const dur = cell.timeSeconds === null ? '—' : `${cell.timeSeconds.toFixed(1)}s`
  const head = `- **${cell.kind}** ${dur}${cell.isError === true ? ' ✗' : ''}`
  if (cell.kind === 'tool') {
    const parts = [head, `\`${cell.text ?? ''}\``]
    const input = snippet(cell.inputDetail)
    const output = snippet(cell.outputDetail)
    if (input !== undefined) parts.push(`\n  <details><summary>input</summary>\n\n  \`\`\`json\n  ${input}\n  \`\`\`\n  </details>`)
    if (output !== undefined && output !== '') parts.push(`\n  <details><summary>output</summary>\n\n  \`\`\`\n  ${output}\n  \`\`\`\n  </details>`)
    return parts.join('')
  }
  const text = snippet(cell.text ?? cell.previewMarkdown)
  if (text === undefined) return head
  return `${head} — ${text.replaceAll('\n', ' ')}`
}

export function toHtml(t: TrajectorySession): string {
  const meta = t.meta
  const body: string[] = []
  body.push(`<h1>${esc(meta.title)}</h1>`)
  body.push(
    `<div class="meta">${esc(meta.model ?? 'unknown model')} · ${esc(meta.projectDir || '')} · ` +
    `${meta.tokens.input.toLocaleString()}→${meta.tokens.output.toLocaleString()} tokens · ` +
    `${meta.costCents === null ? '' : `$${(meta.costCents / 100).toFixed(2)}`}</div>`,
  )
  for (const turn of t.turns) {
    body.push(`<section class="turn"><h2>Turn ${turn.turn}</h2>`)
    for (const group of turn.groups) {
      const desc = group.description === undefined ? '' : `<span class="desc">${esc(group.description)}</span>`
      body.push(`<div class="group"><h3>${esc(group.title)} ${desc}</h3>`)
      for (const cell of group.cells) {
        body.push(cellHtml(cell))
      }
      body.push('</div>')
    }
    body.push('</section>')
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(meta.title)} — Orbit</title>
<style>
  body { background:#0a0a12; color:#e8e8f4; font: 14px/1.6 ui-sans-serif, system-ui, sans-serif; margin:0; padding:40px 16px; }
  .wrap { max-width:860px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 6px; background:linear-gradient(100deg,#22d3ee,#a78bfa); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .meta { color:#8b8ba6; font: 12px ui-monospace, monospace; margin-bottom:24px; }
  h2 { font: 12px ui-monospace, monospace; letter-spacing:.2em; text-transform:uppercase; color:#a78bfa; border-bottom:1px solid #23233c; padding-bottom:6px; }
  h3 { font: 11px ui-monospace, monospace; color:#8b8ba6; margin:18px 0 6px; }
  .desc { color:#22d3ee; margin-left:8px; }
  .cell { border-left:2px solid #23233c; padding:6px 12px; margin:4px 0; font: 13px ui-monospace, monospace; }
  .cell.user { border-color:#22d3ee; } .cell.message { border-color:#a78bfa; } .cell.tool { border-color:#3b3b58; }
  .cell.error { border-color:#f87171; }
  .tag { color:#56566f; font-size:10px; text-transform:uppercase; letter-spacing:.12em; margin-right:10px; }
  .time { color:#8b8ba6; float:right; font-size:11px; }
  pre { background:#12121c; border:1px solid #23233c; border-radius:6px; padding:10px; overflow-x:auto; font-size:12px; color:#c8c8dc; }
  details { margin:6px 0; }
  summary { cursor:pointer; color:#8b8ba6; font-size:12px; }
</style></head><body><div class="wrap">
${body.join('\n')}
</div></body></html>`
}

function cellHtml(cell: TrajectoryCell): string {
  const dur = cell.timeSeconds === null ? '—' : `${cell.timeSeconds.toFixed(1)}s`
  const errorCls = cell.isError === true ? ' error' : ''
  const parts: string[] = []
  parts.push(`<div class="cell ${cell.kind}${errorCls}">`)
  parts.push(`<span class="time">${dur}</span><span class="tag">${esc(cell.kind)}</span>`)
  if (cell.kind === 'tool') {
    parts.push(`<code>${esc(cell.text ?? '')}</code>`)
    const input = snippet(cell.inputDetail)
    const output = snippet(cell.outputDetail)
    if (input !== undefined) {
      parts.push(`<details><summary>input</summary><pre>${esc(input)}</pre></details>`)
    }
    if (output !== undefined && output !== '') {
      parts.push(`<details><summary>output</summary><pre>${esc(output)}</pre></details>`)
    }
  } else {
    const text = snippet(cell.text ?? cell.previewMarkdown)
    if (text !== undefined) parts.push(esc(text))
  }
  parts.push('</div>')
  return parts.join('\n')
}
