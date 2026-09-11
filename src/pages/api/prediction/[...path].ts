import type { APIRoute } from 'astro'
import { proxyService, runtimeEnvironment } from '../../../server/upstream-proxy'
import { predictionPublicConfig } from '../../../server/serverless-prediction'

export const prerender = false

function handler(method: string): APIRoute {
  return ({ request, params, locals }) => {
    if (request.method !== method) return new Response('Method not allowed', { status: 405 })
    if (method === 'GET' && params.path === 'config') {
      try { return Response.json(predictionPublicConfig(runtimeEnvironment(locals)), { headers: { 'cache-control': 'no-store' } }) }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Prediction configuration is unavailable.' }, { status: 503, headers: { 'cache-control': 'no-store' } }) }
    }
    return proxyService(request, params.path, runtimeEnvironment(locals), 'PREDICTION_API_ORIGIN', 'http://127.0.0.1:8788')
  }
}

export const GET = handler('GET')
export const POST = handler('POST')
export const PUT = handler('PUT')
export const PATCH = handler('PATCH')
export const DELETE = handler('DELETE')
export const OPTIONS = handler('OPTIONS')
