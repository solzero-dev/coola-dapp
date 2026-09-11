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
    CREATE TABLE IF NOT EXISTS prediction_markets (
      venue TEXT NOT NULL,
      chain_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      match_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (venue, chain_id, market_id)
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS prediction_matcher_states (
      scope TEXT PRIMARY KEY,
      version BIGINT NOT NULL DEFAULT 0,
      payload TEXT NOT NULL
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS prediction_events (
      sequence BIGSERIAL PRIMARY KEY,
      topic TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )`
  await sql`CREATE INDEX IF NOT EXISTS prediction_events_topic_sequence ON prediction_events(topic, sequence)`
  await sql`
    CREATE TABLE IF NOT EXISTS prediction_nonces (
      scope TEXT NOT NULL,
      nonce TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      PRIMARY KEY (scope, nonce)
    )`
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
