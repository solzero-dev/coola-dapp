import { Database } from 'bun:sqlite'
import { DreamDexGameCreator, type GameQuestion } from '../../packages/adapters/dreamdex/game-creation'
import type { DreamDexPublicConfig } from '../../packages/prediction-core/market-data'
import { erc20Abi, getAddress, type Hex } from 'viem'
import { questionFromArena } from '../../packages/adapters/dreamdex/arena-question'

export { questionFromArena }

/** One local sponsor, one durable creation per room/agent. No game mutations. */
export class GameDemoService {
  private busy = false
  constructor(readonly database: Database, readonly creator: DreamDexGameCreator, readonly gameOrigin: string, readonly fetcher: typeof fetch = fetch) {
    database.exec('CREATE TABLE IF NOT EXISTS dreamdex_game_creations (id TEXT PRIMARY KEY, game TEXT NOT NULL, status TEXT NOT NULL, hash TEXT, binding TEXT)')
    database.exec('CREATE TABLE IF NOT EXISTS dreamdex_demo_funding (address TEXT PRIMARY KEY, token_hash TEXT, native_hash TEXT)')
  }
  publicConfig(): DreamDexPublicConfig {
    const rows = this.database.query<{ binding: string; hash: Hex | null }, []>("SELECT binding, hash FROM dreamdex_game_creations WHERE status='CONFIRMED'").all()
    return { ...this.creator.config, demoCreation: true, markets: rows.map(row => ({ ...JSON.parse(row.binding), ...(row.hash ? { creationTxHash: row.hash } : {}) })) }
  }
  async fund(address: string) {
    const to = getAddress(address), wallet = this.creator.wallet, rpc = this.creator.resources.client.getViemClient()
    if (this.busy) throw Error('The demo operator is processing another transaction. Try again shortly.')
    if (to.toLowerCase() === wallet.account?.address.toLowerCase()) throw Error('The sponsor wallet already holds the demo funds.')
    this.busy = true
    try {
      if (await rpc.getChainId() !== 50312) throw Error('The faucet is Shannon-only.')
      const token = this.creator.resources.reader.network.addresses.collateral!
      const existing = this.database.query<{ token_hash: string | null; native_hash: string | null }, [string]>('SELECT * FROM dreamdex_demo_funding WHERE address=?').get(to)
      if (existing?.native_hash) {
        if (existing.native_hash === 'SUBMITTING') throw Error('Prior test-gas submission needs reconciliation; it will not be repeated.')
        if ((await rpc.waitForTransactionReceipt({ hash: existing.native_hash as Hex })).status !== 'success') throw Error('Test gas transfer reverted.')
        return { message: 'Demo test tokens were already sent to this wallet.', hash: existing.native_hash }
      }
      if (existing && !existing.token_hash) throw Error('Prior faucet submission needs reconciliation; it will not be repeated.')
      if (!existing) {
        if (!wallet.account || await rpc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.account.address] }) < 10_000_000n || await rpc.getBalance({ address: wallet.account.address }) < 2_000_000_000_000_000_000n) throw Error('The demo sponsor needs more test funds.')
        const simulation = await rpc.simulateContract({ address: token, abi: erc20Abi, functionName: 'transfer', args: [to, 10_000_000n], account: wallet.account as never })
        this.database.query('INSERT INTO dreamdex_demo_funding(address) VALUES (?)').run(to)
        const hash = await wallet.writeContract(simulation.request as never)
        this.database.query('UPDATE dreamdex_demo_funding SET token_hash=? WHERE address=?').run(hash, to)
        if ((await rpc.waitForTransactionReceipt({ hash })).status !== 'success') throw Error('Test collateral transfer reverted.')
      } else if ((await rpc.waitForTransactionReceipt({ hash: existing.token_hash as Hex })).status !== 'success') throw Error('Test collateral transfer reverted.')
      // Reserve the second send before broadcasting; an ambiguous send must never
      // become repeated test-native transfers on a user's retry.
      this.database.query("UPDATE dreamdex_demo_funding SET native_hash='SUBMITTING' WHERE address=?").run(to)
      const hash = await wallet.sendTransaction({ to, value: 200_000_000_000_000_000n, account: wallet.account!, chain: wallet.chain })
      this.database.query('UPDATE dreamdex_demo_funding SET native_hash=? WHERE address=?').run(hash, to)
      if ((await rpc.waitForTransactionReceipt({ hash })).status !== 'success') throw Error('Test gas transfer reverted.')
      return { message: 'Sent 10 tUSDC and 0.2 test SOMI. Test tokens only.', hash }
    } finally { this.busy = false }
  }
  async create(eventId: string, agentId: string) {
    if (!eventId || !agentId || eventId.length > 200 || agentId.length > 100) throw Error('Select a game and participant.')
    if (this.busy) throw Error('A game question is being opened. Wait for confirmation, then refresh.')
    this.busy = true
    try {
      const id = JSON.stringify([eventId, agentId])
      const row = this.database.query<{ game: string; status: string; hash: Hex | null; binding: string | null }, [string]>('SELECT * FROM dreamdex_game_creations WHERE id=?').get(id)
      if (row?.binding) return { hash: row.hash, market: JSON.parse(row.binding) }
      if (row) {
        if (!row.hash) throw Error('Previous submission needs reconciliation. It will not be sent twice.')
        const market = await this.creator.confirm(JSON.parse(row.game), row.hash)
        this.database.query("UPDATE dreamdex_game_creations SET status='CONFIRMED', binding=? WHERE id=?").run(JSON.stringify(market), id)
        return { hash: row.hash, market }
      }
      // Only the current real roster is eligible; the unique room/agent key
      // limits this to twelve creations per match, without blocking later games.
      const read = async (path: string) => {
        const r = await this.fetcher(new URL(path, this.gameOrigin), { signal: AbortSignal.timeout(10000), redirect: 'error' })
        if (!r.ok) throw Error('The authoritative game service is unavailable.')
        return r.json()
      }
      const [raw, agents] = await Promise.all([read('/api/v1/agent-arena'), read('/api/v1/genesis-agents')])
      const game = questionFromArena(raw, agents, eventId, agentId, this.gameOrigin)
      const result = await this.creator.create(game,
        () => this.database.query("INSERT INTO dreamdex_game_creations(id,game,status) VALUES (?,?,'SUBMITTING')").run(id, JSON.stringify(game)),
        hash => this.database.query("UPDATE dreamdex_game_creations SET hash=? WHERE id=?").run(hash, id))
      this.database.query("UPDATE dreamdex_game_creations SET status='CONFIRMED', binding=? WHERE id=?").run(JSON.stringify(result.market), id)
      // Creation is already durable. Liquidity is a separate sponsored workflow;
      // never repeat market creation if one of these later transactions fails.
      try {
        const sponsoredTransactions = await this.creator.seed(result.market.marketId)
        const market = { ...result.market, sponsoredTransactions }
        this.database.query("UPDATE dreamdex_game_creations SET binding=? WHERE id=?").run(JSON.stringify(market), id)
        return { ...result, market }
      } catch (error) { return { ...result, liquidityWarning: error instanceof Error ? error.message : 'Starter liquidity unavailable; limit orders can still be placed.' } }
    } finally { this.busy = false }
  }
}
