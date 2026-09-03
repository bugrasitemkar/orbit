import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { createApp } from './routes.ts'
import { initSchema, openDb } from './db.ts'
import { defaultClaudeDir, scanAll, startWatcher } from './indexer.ts'

const PORT = Number(process.env.PORT ?? 4810)
const DATA_DIR = process.env.ORBIT_DATA_DIR ?? join(import.meta.dir, '../../../data')
const CLAUDE_DIR = defaultClaudeDir()

mkdirSync(DATA_DIR, { recursive: true })
const db = openDb(join(DATA_DIR, 'orbit.db'))
initSchema(db)

console.log(`◤ Orbit — indexing ${CLAUDE_DIR} …`)
const start = Date.now()
const indexed = await scanAll(db, CLAUDE_DIR)
console.log(`  indexed ${indexed} changed file(s) in ${((Date.now() - start) / 1000).toFixed(1)}s`)

const watcher = startWatcher(db, CLAUDE_DIR)
console.log(`  watching for live session updates`)

const app = createApp(db)

export default {
  port: PORT,
  fetch: app.fetch,
}

console.log(`◤ Orbit ready → http://localhost:${PORT}`)
