import type { MatcherState, MatcherStore } from '../../apps/matcher/store'
import { marketScopeKey, type MarketScope } from '../../apps/matcher/settlement'
import { decodeStored, encodeStored } from '../../packages/prediction-core/serialization'
import type { serverDatabase } from './database-url'

type Database = ReturnType<typeof serverDatabase>

/** PostgreSQL implementation for serverless matcher requests. Row locking keeps each market atomic across functions. */
export class PostgresMatcherStore implements MatcherStore {
  constructor(private readonly sql: Database) {}

  async read(scope: MarketScope): Promise<MatcherState | undefined> {
    const key = marketScopeKey(scope)
    const rows = await this.sql<{ payload: string }[]>`SELECT payload FROM prediction_matcher_states WHERE scope = ${key}`
    return rows[0] ? decodeStored<MatcherState>(rows[0].payload) : undefined
  }

  async transaction<T>(scope: MarketScope, operation: (current: MatcherState | undefined) => { state: MatcherState; result: T }): Promise<T> {
    const key = marketScopeKey(scope)
    return await this.sql.begin(async transaction => {
      const tx = transaction as unknown as Database
      // Ensure a row exists before locking it; the unique scope serializes first writers.
      await tx`INSERT INTO prediction_matcher_states(scope, payload) VALUES (${key}, ${encodeStored(undefined)}) ON CONFLICT (scope) DO NOTHING`
      const rows = await tx<{ payload: string }[]>`SELECT payload FROM prediction_matcher_states WHERE scope = ${key} FOR UPDATE`
      const previous = rows[0]?.payload === encodeStored(undefined) ? undefined : rows[0] ? decodeStored<MatcherState>(rows[0].payload) : undefined
      const { state, result } = operation(structuredClone(previous))
      await tx`UPDATE prediction_matcher_states SET payload = ${encodeStored(state)}, version = version + 1 WHERE scope = ${key}`
      return structuredClone(result)
    }) as T
  }
}
