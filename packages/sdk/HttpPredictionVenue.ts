import type { PredictionVenue } from '../venue-interface/PredictionVenue'
import type { Balance, Market, Order, OrderBook, OrderResult, PlaceOrderInput, Position, SignedOrder, TxResult, VenueId } from '../prediction-core/types'
import { stringify } from '../prediction-core/serialization'
import { parseSignedOrder, PredictionError, validateMarket, validateOrder } from '../prediction-core/validation'
import { proofHeaders, requestAuthMessage } from './auth'
import { parsePredictionResponse } from './wire'
import type { PortfolioPosition } from '../prediction-core/market-data'
import { apiUrl } from './api-url'

export interface VenueClientOptions {
  baseUrl: string
  audience: string
  venue: VenueId
  chainId: string
  account: string
  signOrder: (input: PlaceOrderInput) => Promise<SignedOrder>
  signRequest: (message: string) => Promise<string>
  redeem: (marketId: string) => Promise<TxResult>
  fetch?: typeof fetch
  now?: () => number
}

/** Portable client; wallet/session signing is injected by the host, outside feature components. */
export class HttpPredictionVenue implements PredictionVenue {
  readonly venue: VenueId
  readonly chainId: string
  readonly account: string
  protected readonly options: VenueClientOptions
  private serverClock?: { timestamp: number; observed: number }
  constructor(options: VenueClientOptions) {
    this.options = options
    this.venue = options.venue
    this.chainId = options.chainId
    this.account = options.account
  }
  synchronizeClock(timestamp: number): void {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new PredictionError('INVALID_CLOCK', 'Invalid prediction server clock.')
    this.serverClock = { timestamp, observed: performance.now() }
  }
  currentTime(): number { return this.options.now?.() ?? (this.serverClock ? Math.floor(this.serverClock.timestamp + performance.now() - this.serverClock.observed) : Date.now()) }

  protected async request<T>(path: string, method = 'GET', value?: unknown, authorize = false): Promise<T> {
    const url = apiUrl(this.options.baseUrl, path)
    url.searchParams.set('venue', this.venue)
    url.searchParams.set('chainId', this.chainId)
    const body = value === undefined ? '' : stringify(value)
    let headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' }
    if (authorize) {
      const proof = { venue: this.venue, chainId: this.chainId, account: this.account, nonce: crypto.randomUUID(), expiresAt: this.currentTime() + 30_000 }
      const message = await requestAuthMessage(this.options.audience, method, `${url.pathname}${url.search}`, body, proof)
      headers = { ...headers, ...proofHeaders({ ...proof, signature: await this.options.signRequest(message) }) }
    }
    const response = await (this.options.fetch ?? fetch)(url, { method, headers, ...(body ? { body } : {}), signal: AbortSignal.timeout(15_000) })
    const payload = parsePredictionResponse<T & { code?: string; message?: string }>(await response.text())
    if (!response.ok) throw new PredictionError(payload.code ?? 'VENUE_ERROR', payload.message ?? `Venue returned HTTP ${response.status}.`, response.status)
    return payload
  }

  async listMarkets(): Promise<Market[]> {
    const markets = await this.request<Market[]>('/markets')
    markets.forEach(market => { validateMarket(market); this.checkScope(market) })
    return markets
  }
  private checkScope(market: Market, id?: string): void {
    if (market.venue !== this.venue || market.chainId !== this.chainId || (id !== undefined && market.id !== id)) throw new PredictionError('VENUE_MISMATCH', 'Server returned a market outside the selected venue.')
  }
  async getMarket(id: string): Promise<Market> { const market = await this.request<Market>(`/markets/${encodeURIComponent(id)}`); validateMarket(market); this.checkScope(market, id); return market }
  getOrderBook(id: string, outcomeId?: number): Promise<OrderBook> { return this.request(`/markets/${encodeURIComponent(id)}/orderbook${outcomeId === undefined ? '' : `?outcomeId=${outcomeId}`}`) }
  getPortfolioPositions(account: string): Promise<PortfolioPosition[]> { return this.request(`/users/${encodeURIComponent(account)}/positions`) }
  async getPositions(account: string): Promise<Position[]> {
    const positions = await this.getPortfolioPositions(account)
    if (positions.some(position => position.accountingComplete === false || typeof position.costBasis !== 'bigint' || typeof position.realizedPnl !== 'bigint')) throw new PredictionError('ACCOUNTING_UNAVAILABLE', 'Complete position cost and realized PnL are required for automated trading.', 503)
    return positions as Position[]
  }
  getOpenOrders(account: string, marketId?: string): Promise<Order[]> { return this.request(`/users/${encodeURIComponent(account)}/orders${marketId === undefined ? '' : `?marketId=${encodeURIComponent(marketId)}`}`) }
  async placeOrder(input: PlaceOrderInput): Promise<OrderResult> {
    const market = await this.getMarket(input.marketId)
    const order = parseSignedOrder(await this.options.signOrder(input))
    validateOrder(order, market, this.currentTime())
    const sameAccount = this.venue === 'SOLANA' ? order.maker === this.account : order.maker.toLowerCase() === this.account.toLowerCase()
    if (!sameAccount || order.venue !== this.venue || order.chainId !== this.chainId || order.marketId !== input.marketId || order.outcomeId !== input.outcomeId || order.side !== input.side || order.price !== input.price || order.quantity !== input.quantity || order.expiresAt !== input.expiresAt) throw new PredictionError('SIGNER_MISMATCH', 'Signer changed the requested order.')
    return this.request('/orders', 'POST', order, true)
  }
  async cancelOrder(orderId: string): Promise<TxResult> { return this.request(`/orders/${encodeURIComponent(orderId)}`, 'DELETE', undefined, true) }
  cancelAllOrders(marketId?: string): Promise<TxResult> { return this.request('/orders/cancel-all', 'POST', { marketId }, true) }
  redeem(marketId: string): Promise<TxResult> { return this.options.redeem(marketId) }
  getBalance(account: string): Promise<Balance> { return this.request(`/users/${encodeURIComponent(account)}/balance`) }
}
