import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api, type SessionFile } from '../api.ts'
import { compactRows, diffLines, type DiffRow } from '../diff.ts'
import { fmtClock } from '../format.ts'

export default function FileDiffs({ id }: { id: string }) {
  const [files, setFiles] = useState<SessionFile[] | null>(null)

  useEffect(() => {
    setFiles(null)
    void api.files(id).then(res => setFiles(res.files)).catch(() => setFiles([]))
  }, [id])

  if (files === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 font-mono text-xs text-dim">
        <Loader2 size={14} className="spin-slow text-neon" /> loading file changes…
      </div>
    )
  }
  if (files.length === 0) {
    return <div className="m-6 font-mono text-xs text-faint">no file edits recorded in this session</div>
  }
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {files.map(file => (
        <div key={file.path} className="rounded-lg border border-edge bg-panel/50">
          <div className="flex items-center gap-2 border-b border-edge px-3.5 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neon" title={file.path}>
              {file.path}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-faint">{file.edits.length} edit{file.edits.length > 1 ? 's' : ''}</span>
          </div>
          <div className="px-3.5 py-3">
            {file.edits.map((edit, i) => (
              <Hunk key={`${edit.seq}-${i}`} path={file.path} old={edit.old} fresh={edit.new} time={edit.time} tool={edit.tool} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Hunk({ path: _path, old, fresh, time, tool }: {
  path: string
  old: string | null
  fresh: string | null
  time: number | null
  tool: string
}) {
  let rows: DiffRow[]
  if (old === null) {
    rows = (fresh ?? '').split('\n').map(text => ({ kind: 'add' as const, text }))
  } else if (fresh === null) {
    rows = old.split('\n').map(text => ({ kind: 'remove' as const, text }))
  } else {
    rows = compactRows(diffLines(old, fresh))
  }
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.15em] text-faint">
        <span>{tool}</span>
        {time !== null && <span>{fmtClock(time)}</span>}
      </div>
      <div className="overflow-hidden rounded-md border border-edge/70 bg-void/60 font-mono text-[11px] leading-[1.5]">
        {rows.map((row, i) => (
          <div
            key={i}
            className={`flex whitespace-pre-wrap break-words px-2 py-[1px] ${
              row.kind === 'add'
                ? 'bg-ok/10 text-ok'
                : row.kind === 'remove'
                  ? 'bg-err/10 text-err'
                  : 'text-dim'
            }`}
          >
            <span className="mr-2 w-3 shrink-0 select-none text-faint">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}</span>
            <span className="min-w-0 flex-1">{row.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
