import { ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import { apiUrl as apiEndpoint } from '../../../packages/sdk/api-url'

type Props = { apiUrl: string; eventId?: string; agentId?: string; onOpened: () => void }

/** Explicit testnet operator action: market creation spends sponsored native gas. */
export function OpenDreamDexMarket({ apiUrl, eventId, agentId, onOpened }: Props) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  if (!apiUrl || !eventId || !agentId?.startsWith('genesis-')) return null
  async function open() {
    if (busy) return
    setBusy(true); setMessage('Opening the DreamDEX event contract…')
    try {
      const response = await fetch(apiEndpoint(apiUrl, '/dreamdex/game-markets'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId, agentId }) })
      const result = await response.json()
      if (!response.ok || !result.market?.marketId) throw Error(result.error ?? 'Market creation did not complete.')
      setMessage('Event contract confirmed. Loading the market…')
      onOpened()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Market creation did not complete.') }
    finally { setBusy(false) }
  }
  return <div className="ch-open-market"><div><strong>No market opened for this match.</strong><span>Each match needs its own YES/NO question market. Open this one on Shannon with sponsored testnet gas, then place your trade here.</span></div><button type="button" onClick={() => void open()} disabled={busy}>{busy ? 'Opening market…' : 'Open market · sponsored'}<ArrowUpRight size={14}/></button>{message && <p role="status">{message}</p>}</div>
}
