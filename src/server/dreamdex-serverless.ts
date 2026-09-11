import { createWalletClient, erc20Abi, getAddress, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { dreamDexNetwork } from '../../packages/adapters/dreamdex/event-reader'
import { DreamDexGameCreator, type GameQuestion } from '../../packages/adapters/dreamdex/game-creation'
import { questionFromArena } from '../../packages/adapters/dreamdex/arena-question'
import { migrateServerDatabase, serverDatabase } from './database-url'

type RuntimeEnv = Record<string, unknown>

const deployment = {
  operatorId: 22,
  venueId: '0x6891b01528b646d3d0e273b7a56a751ccd9937f93c4f054a2a00404bb4fe6462',
} as const

function environment(runtime: RuntimeEnv, name: string) {
  return String(runtime[name] ?? (typeof process !== 'undefined' ? process.env[name] : undefined) ?? '').trim()
}

function gameOrigin(runtime: RuntimeEnv) {
  return environment(runtime, 'SOLZ_GAME_API_ORIGIN') || 'https://solz-elysia-production.up.railway.app'
}

async function setup(runtime: RuntimeEnv) {
  const key = environment(runtime, 'PVT_KEY')
  if (!key) throw Error('PVT_KEY is required for sponsored DreamDEX actions.')
  const account = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`)
  const { id, name, nativeCurrency, rpcUrls, blockExplorers } = dreamDexNetwork('50312').chain
  const wallet = createWalletClient({ account, chain: { id, name, nativeCurrency, rpcUrls, blockExplorers }, transport: http(rpcUrls.default.http[0]) })
  const creator = new DreamDexGameCreator({ chainId: '50312', label: 'Shannon · SOLZ game events', indexerUrl: 'https://dev.smk.somnia.host/v1/graphql', wsRpcUrl: 'wss://api.infra.testnet.somnia.network/ws', markets: [] }, wallet, Number(environment(runtime, 'DREAMDEX_OPERATOR_ID') || deployment.operatorId), (environment(runtime, 'DREAMDEX_VENUE_ID') || deployment.venueId) as `0x${string}`)
  await creator.verifyImplementation()
  return creator
}

async function currentQuestion(eventId: string, agentId: string, origin: string): Promise<GameQuestion> {
  const read = async (path: string) => {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(10_000), redirect: 'error' })
    if (!response.ok) throw Error('The authoritative game service is unavailable.')
    return response.json()
  }
  const [raw, agents] = await Promise.all([read('/api/v1/agent-arena'), read('/api/v1/genesis-agents')])
  return questionFromArena(raw, agents, eventId, agentId, origin)
}

type CreationRow = { game: string; status: string; hash: string | null; binding: string | null }

export class ServerlessDreamDexDemo {
  constructor(private readonly sql: ReturnType<typeof serverDatabase>, private readonly runtime: RuntimeEnv) {}

  static async create(runtime: RuntimeEnv) {
    const sql = serverDatabase(runtime)
    await migrateServerDatabase(sql)
    return new ServerlessDreamDexDemo(sql, runtime)
  }

  async config() {
    const creator = await setup(this.runtime)
    const rows = await this.sql<{ binding: string; hash: string | null }[]>`SELECT binding, hash FROM dreamdex_game_creations WHERE status = 'CONFIRMED'`
    return { audience: '', venues: [], dreamdex: [{ ...creator.config, demoCreation: true, markets: rows.map(row => ({ ...JSON.parse(row.binding), ...(row.hash ? { creationTxHash: row.hash } : {}) })) }] }
  }

  async createMarket(eventId: string, agentId: string) {
    if (!eventId || !agentId || eventId.length > 200 || agentId.length > 100) throw Error('Select a game and participant.')
    const id = JSON.stringify([eventId, agentId])
    const creator = await setup(this.runtime)
    const existing = await this.sql<CreationRow[]>`SELECT game, status, hash, binding FROM dreamdex_game_creations WHERE id = ${id}`
    const row = existing[0]
    if (row?.binding) return { hash: row.hash, market: JSON.parse(row.binding) }
    if (row) {
      if (!row.hash) throw Error('Previous submission needs reconciliation. It will not be sent twice.')
      const market = await creator.confirm(JSON.parse(row.game), row.hash as `0x${string}`)
      await this.sql`UPDATE dreamdex_game_creations SET status = 'CONFIRMED', binding = ${JSON.stringify(market)} WHERE id = ${id}`
      return { hash: row.hash, market }
    }
    const game = await currentQuestion(eventId, agentId, gameOrigin(this.runtime))
    await this.sql`INSERT INTO dreamdex_game_creations(id, game, status) VALUES (${id}, ${JSON.stringify(game)}, 'SUBMITTING')`
    const result = await creator.create(game, async () => {}, async hash => { await this.sql`UPDATE dreamdex_game_creations SET hash = ${hash} WHERE id = ${id}` })
    await this.sql`UPDATE dreamdex_game_creations SET status = 'CONFIRMED', binding = ${JSON.stringify(result.market)} WHERE id = ${id}`
    try {
      const sponsoredTransactions = await creator.seed(result.market.marketId)
      const market = { ...result.market, sponsoredTransactions }
      await this.sql`UPDATE dreamdex_game_creations SET binding = ${JSON.stringify(market)} WHERE id = ${id}`
      return { ...result, market }
    } catch (error) { return { ...result, liquidityWarning: error instanceof Error ? error.message : 'Starter liquidity unavailable; limit orders can still be placed.' } }
  }

  async fund(address: string) {
    const to = getAddress(address), creator = await setup(this.runtime), wallet = creator.wallet, rpc = creator.resources.client.getViemClient()
    if (to.toLowerCase() === wallet.account?.address.toLowerCase()) throw Error('The sponsor wallet already holds the demo funds.')
    if (await rpc.getChainId() !== 50312) throw Error('The faucet is Shannon-only.')
    const rows = await this.sql<{ token_hash: string | null; native_hash: string | null }[]>`SELECT token_hash, native_hash FROM dreamdex_demo_funding WHERE address = ${to}`
    const existing = rows[0]
    if (existing?.native_hash) {
      if (existing.native_hash === 'SUBMITTING') throw Error('Prior test-gas submission needs reconciliation; it will not be repeated.')
      if ((await rpc.waitForTransactionReceipt({ hash: existing.native_hash as `0x${string}` })).status !== 'success') throw Error('Test gas transfer reverted.')
      return { message: 'Demo test tokens were already sent to this wallet.', hash: existing.native_hash }
    }
    const token = creator.resources.reader.network.addresses.collateral!
    if (!existing) {
      if (!wallet.account || await rpc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.account.address] }) < 10_000_000n || await rpc.getBalance({ address: wallet.account.address }) < 2_000_000_000_000_000_000n) throw Error('The demo sponsor needs more test funds.')
      await this.sql`INSERT INTO dreamdex_demo_funding(address) VALUES (${to})`
      const simulation = await rpc.simulateContract({ address: token, abi: erc20Abi, functionName: 'transfer', args: [to, 10_000_000n], account: wallet.account as never })
      const hash = await wallet.writeContract(simulation.request as never)
      await this.sql`UPDATE dreamdex_demo_funding SET token_hash = ${hash} WHERE address = ${to}`
    } else if (!existing.token_hash) throw Error('Prior faucet submission needs reconciliation; it will not be repeated.')
    await this.sql`UPDATE dreamdex_demo_funding SET native_hash = 'SUBMITTING' WHERE address = ${to}`
    const hash = await wallet.sendTransaction({ to, value: 200_000_000_000_000_000n, account: wallet.account!, chain: wallet.chain })
    await this.sql`UPDATE dreamdex_demo_funding SET native_hash = ${hash} WHERE address = ${to}`
    if ((await rpc.waitForTransactionReceipt({ hash })).status !== 'success') throw Error('Test gas transfer reverted.')
    return { message: 'Sent 10 tUSDC and 0.2 test SOMI. Test tokens only.', hash }
  }
}
