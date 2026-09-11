import type { APIRoute } from 'astro'
import { proxyService, runtimeEnvironment } from '../../../server/upstream-proxy'

export const prerender = false

function handler(method: string): APIRoute {
  return ({ request, params, locals }) => {
    if (request.method !== method) return new Response('Method not allowed', { status: 405 })
    return proxyService(request, params.path, runtimeEnvironment(locals), 'PREDICTION_API_ORIGIN', 'http://127.0.0.1:8788')
  }
}

export const GET = handler('GET')
export const POST = handler('POST')
export const PUT = handler('PUT')
export const PATCH = handler('PATCH')
export const DELETE = handler('DELETE')
export const OPTIONS = handler('OPTIONS')
