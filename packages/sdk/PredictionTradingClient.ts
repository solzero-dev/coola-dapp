import type { Candle, MarketSnapshot, PredictionPublicConfig } from '../prediction-core/market-data'
import type { MarketExecution, MarketExecutionQuote, MarketQuoteRequest } from '../prediction-core/execution'
import type { SignedOrder } from '../prediction-core/types'
import { PredictionError, parseSignedOrder, validateOrder } from '../prediction-core/validation'
import { HttpPredictionVenue } from './HttpPredictionVenue'
import { parsePredictionResponse } from './wire'
import { apiUrl } from './api-url'

export async function getPredictionConfig(baseUrl: string, signal?: AbortSignal): Promise<PredictionPublicConfig> {
  const response = await fetch(apiUrl(baseUrl, '/config'), { signal: signal ?? AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error('Prediction service is unavailable.')
  const value = await response.json() as PredictionPublicConfig
  if (!Array.isArray(value.venues) || typeof value.audience !== 'string') throw new Error('Prediction service returned invalid configuration.')
  return value
}

/** A feed event is an invalidation; snapshots supply one coherent market/book/trade view. */
export class PredictionTradingClient extends HttpPredictionVenue {
  getHermesStatus(): Promise<{ state: string; marketId?: string; updatedAt?: number; reasonCode?: string }> { return this.request(`/users/${encodeURIComponent(this.account)}/hermes`) }
  startHermes(marketId: string, prompt: string): Promise<unknown> { return this.request('/hermes/start', 'POST', { marketId, prompt }, true) }
  stopHermes(): Promise<unknown> { return this.request('/hermes/stop', 'POST', {}, true) }
  async getSnapshot(marketId: string): Promise<MarketSnapshot> {
    const snapshot = await this.request<MarketSnapshot>(`/markets/${encodeURIComponent(marketId)}/snapshot`)
    this.synchronizeClock(snapshot.serverTime)
    return snapshot
  }
  getCandles(marketId: string, outcomeId: number, intervalMs = 60_000): Promise<Candle[]> { return this.request(`/markets/${encodeURIComponent(marketId)}/candles?outcomeId=${outcomeId}&intervalMs=${intervalMs}`) }
  quoteMarketOrder(marketId: string, input: Omit<MarketQuoteRequest, 'account'>): Promise<MarketExecutionQuote> {
    return this.request(`/markets/${encodeURIComponent(marketId)}/quote`, 'POST', { ...input, account: this.account })
  }
  async executeQuote(quote: MarketExecutionQuote): Promise<MarketExecution> {
    const sameAccount = this.venue === 'SOLANA' ? quote.account === this.account : quote.account.toLowerCase() === this.account.toLowerCase()
    if (quote.venue !== this.venue || quote.chainId !== this.chainId || !sameAccount || quote.expiresAt <= this.currentTime()) throw new PredictionError('STALE_QUOTE', 'Request a fresh quote for this wallet.')
    if (!quote.children.length) throw new PredictionError('NO_LIQUIDITY', 'There is no executable liquidity within your price limit.')
    const market = await this.getMarket(quote.marketId)
    const orders: SignedOrder[] = []
    for (const child of quote.children) {
      if (quote.expiresAt <= this.currentTime()) throw new PredictionError('STALE_QUOTE', 'Quote expired while signing. Request a new quote.')
      const order = parseSignedOrder(await this.options.signOrder({ marketId: quote.marketId, outcomeId: quote.outcomeId, side: quote.side, price: child.price, quantity: child.quantity, expiresAt: quote.orderExpiresAt }))
      validateOrder(order, market, this.currentTime())
      const sameAccount = this.venue === 'SOLANA' ? order.maker === this.account : order.maker.toLowerCase() === this.account.toLowerCase()
      if (!sameAccount || order.venue !== this.venue || order.chainId !== this.chainId || order.marketId !== quote.marketId || order.outcomeId !== quote.outcomeId || order.side !== quote.side || order.price !== child.price || order.quantity !== child.quantity || order.expiresAt !== quote.orderExpiresAt) throw new PredictionError('SIGNER_MISMATCH', 'Wallet changed an order in the quote.')
      orders.push(order)
    }
    return this.request('/executions', 'POST', { marketId: quote.marketId, intent: { type: 'MARKET_IOC', quoteId: quote.id, quoteHash: quote.quoteHash, childrenHash: quote.childrenHash }, orders }, true)
  }
  getExecution(marketId: string, id: string): Promise<MarketExecution> { return this.request(`/executions/${encodeURIComponent(id)}?marketId=${encodeURIComponent(marketId)}`, 'GET', undefined, true) }
  /** No signatures needed for own public order status; private execution intent is authenticated. */
  getExecutions(marketId: string): Promise<MarketExecution[]> { return this.request(`/users/${encodeURIComponent(this.account)}/executions?marketId=${encodeURIComponent(marketId)}`) }

  subscribeMatch(matchId: string, onChange: () => void): () => void { return this.subscribe(matchId, 0, onChange, () => {}, undefined, 'matches') }
  subscribe(marketId: string, after: number, onChange: () => void, onConnection: (state: 'connected' | 'reconnecting') => void, socketFactory: (url: string) => WebSocket = url => new WebSocket(url), topic: 'markets' | 'matches' = 'markets'): () => void {
    let closed = false
    let socket: WebSocket | undefined
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    let sequence = after
    const connect = () => {
      if (closed) return
      const url = new URL(`/${topic}/${encodeURIComponent(marketId)}`, this.options.baseUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('venue', this.venue); url.searchParams.set('chainId', this.chainId); url.searchParams.set('after', String(sequence))
      try {
        socket = socketFactory(url.toString())
        socket.onopen = () => { if (closed) return; failures = 0; onConnection('connected'); onChange() }
        socket.onmessage = event => {
          try {
            const value = parsePredictionResponse<{ sequence: number }>(String(event.data))
            if (!Number.isSafeInteger(value.sequence) || value.sequence <= sequence) return
            sequence = value.sequence
            onChange()
          } catch { /* Malformed messages do not advance the resume cursor. */ }
        }
        socket.onerror = () => socket?.close()
        socket.onclose = () => { if (closed) return; onConnection('reconnecting'); reconnect = setTimeout(connect, Math.min(15_000, 500 * 2 ** failures++)) }
      } catch { if (!closed) { onConnection('reconnecting'); reconnect = setTimeout(connect, Math.min(15_000, 500 * 2 ** failures++)) } }
    }
    connect()
    return () => { closed = true; clearTimeout(reconnect); if (socket) { socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.close() } }
  }
}
