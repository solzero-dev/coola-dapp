import postgres from 'postgres'

type RuntimeEnv = Record<string, unknown>

function value(runtime: RuntimeEnv, name: string) {
  return String(runtime[name] ?? (typeof process !== 'undefined' ? process.env[name] : undefined) ?? '').trim()
}

/** A request-scoped serverless connection. DATABASE_URL never enters React props. */
export function serverDatabase(runtime: RuntimeEnv) {
  const url = value(runtime, 'DATABASE_URL')
  if (!url) throw Error('DATABASE_URL is required for serverless prediction services.')
  return postgres(url, { max: 1, prepare: false, idle_timeout: 10, connect_timeout: 10 })
}

export async function migrateServerDatabase(sql: ReturnType<typeof serverDatabase>) {
  await sql`
    CREATE TABLE IF NOT EXISTS dreamdex_game_creations (
      id TEXT PRIMARY KEY,
      game TEXT NOT NULL,
      status TEXT NOT NULL,
      hash TEXT,
      binding TEXT
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS dreamdex_demo_funding (
      address TEXT PRIMARY KEY,
      token_hash TEXT,
      native_hash TEXT
    )`
}
