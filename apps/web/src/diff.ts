/**
 * Minimal line diff (LCS-based) for rendering Edit hunks as red/green rows.
 */
export interface DiffRow {
  kind: 'same' | 'add' | 'remove'
  text: string
}

export function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length
  if (n === 0) return b.map(text => ({ kind: 'add', text }))
  if (m === 0) return a.map(text => ({ kind: 'remove', text }))
  if (n * m > 4_000_000) {
    // Degenerate input: show both sides wholesale instead of an LCS blowup.
    return [
      ...a.map(text => ({ kind: 'remove' as const, text })),
      ...b.map(text => ({ kind: 'add' as const, text })),
    ]
  }
  // LCS lengths
  const dp: number[] = new Array((n + 1) * (m + 1)).fill(0)
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const idx = i * (m + 1) + j
      if (a[i - 1] === b[j - 1]) {
        dp[idx] = dp[(i - 1) * (m + 1) + (j - 1)]! + 1
      } else {
        const up = dp[(i - 1) * (m + 1) + j]!
        const left = dp[i * (m + 1) + (j - 1)]!
        dp[idx] = up > left ? up : left
      }
    }
  }
  // Backtrack
  const rows: DiffRow[] = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      rows.push({ kind: 'same', text: a[i - 1]! })
      i--
      j--
    } else if (dp[(i - 1) * (m + 1) + j]! >= dp[i * (m + 1) + (j - 1)]!) {
      rows.push({ kind: 'remove', text: a[i - 1]! })
      i--
    } else {
      rows.push({ kind: 'add', text: b[j - 1]! })
      j--
    }
  }
  while (i > 0) {
    rows.push({ kind: 'remove', text: a[i - 1]! })
    i--
  }
  while (j > 0) {
    rows.push({ kind: 'add', text: b[j - 1]! })
    j--
  }
  return rows.reverse()
}

/** Compact aligned rows: keep unchanged lines, cap context runs. */
export function compactRows(rows: DiffRow[], context = 3): DiffRow[] {
  const out: DiffRow[] = []
  let skipped = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row.kind === 'same') {
      // Include same-lines only within `context` of a change.
      const nearChange = rows.slice(Math.max(0, i - context), i).some(r => r.kind !== 'same')
        || rows.slice(i + 1, i + 1 + context).some(r => r.kind !== 'same')
      if (nearChange) {
        if (skipped > 0) {
          out.push({ kind: 'same', text: `… ${skipped} unchanged lines …` })
          skipped = 0
        }
        out.push(row)
      } else {
        skipped++
      }
    } else {
      skipped = 0
      out.push(row)
    }
  }
  if (skipped > 0) out.push({ kind: 'same', text: `… ${skipped} unchanged lines …` })
  return out
}
