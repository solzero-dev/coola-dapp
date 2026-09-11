import type { APIRoute } from 'astro'
import { ServerlessDreamDexDemo } from '../../../server/dreamdex-serverless'
import { runtimeEnvironment } from '../../../server/upstream-proxy'

export const prerender = false

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const demo = await ServerlessDreamDexDemo.create(runtimeEnvironment(locals))
    if (params.path === 'config') return json(await demo.config())
    return json({ error: 'Not found' }, 404)
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'DreamDEX service unavailable.' }, 503) }
}

export const POST: APIRoute = async ({ request, params, locals }) => {
  try {
    const demo = await ServerlessDreamDexDemo.create(runtimeEnvironment(locals))
    const input = await request.json() as { eventId?: unknown; agentId?: unknown; address?: unknown }
    if (params.path === 'dreamdex/game-markets') {
      if (typeof input.eventId !== 'string' || typeof input.agentId !== 'string') return json({ error: 'Select a game and agent.' }, 400)
      return json(await demo.createMarket(input.eventId, input.agentId))
    }
    if (params.path === 'dreamdex/faucet') {
      if (typeof input.address !== 'string') return json({ error: 'Connect your Dynamic EVM wallet first.' }, 400)
      return json(await demo.fund(input.address))
    }
    return json({ error: 'Not found' }, 404)
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Creation failed.' }, 409) }
}
