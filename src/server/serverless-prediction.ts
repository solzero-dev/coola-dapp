import { publicVenueConfig } from '../../apps/api/public-config'
import { parseEvmConfig } from '../../packages/adapters/config'
import { parseDreamDexPublicConfig } from '../../packages/adapters/dreamdex/config'
import { parseSolanaConfig } from '../../packages/adapters/solana/gateway'
import type { PredictionPublicConfig } from '../../packages/prediction-core/market-data'

type RuntimeEnv = Record<string, unknown>

function value(runtime: RuntimeEnv, name: string) {
  return String(runtime[name] ?? (typeof process !== 'undefined' ? process.env[name] : undefined) ?? '').trim()
}

function array(runtime: RuntimeEnv, name: string): unknown[] {
  const raw = value(runtime, name)
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw Error(`${name} must contain a JSON array.`)
  return parsed
}

/** Reads private deployment configuration in the function and returns its safe public subset. */
export function predictionPublicConfig(runtime: RuntimeEnv): PredictionPublicConfig {
  const venues = array(runtime, 'PREDICTION_VENUES_JSON').map(raw => {
    const family = (raw as { family?: unknown }).family
    return publicVenueConfig(family === 'SOLANA' ? parseSolanaConfig(raw) : parseEvmConfig(raw))
  })
  return {
    audience: value(runtime, 'PREDICTION_AUTH_AUDIENCE'),
    venues,
    dreamdex: array(runtime, 'PREDICTION_DREAMDEX_JSON').map(parseDreamDexPublicConfig),
  }
}
