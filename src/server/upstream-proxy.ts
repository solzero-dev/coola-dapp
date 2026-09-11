type RuntimeEnv = Record<string, unknown>

const hopByHopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']

function configuredOrigin(runtime: RuntimeEnv, name: string, developmentFallback: string) {
  const value = String(runtime[name] ?? (typeof process !== 'undefined' ? process.env[name] : undefined) ?? '').trim().replace(/\/+$/, '')
  if (value) return value
  return import.meta.env.DEV ? developmentFallback : ''
}

function unavailable(service: string) {
  return Response.json({ error: `${service} is not configured. Set its server-only upstream origin.` }, {
    status: 503,
    headers: { 'cache-control': 'no-store' },
  })
}

/**
 * Exposes a same-origin Astro endpoint while keeping the stateful service and
 * its credentials off the browser. Vercel functions do not proxy WebSockets,
 * so clients use HTTP refresh when this gateway is selected.
 */
export async function proxyService(request: Request, path: string | undefined, runtime: RuntimeEnv, environmentName: string, developmentFallback: string) {
  const origin = configuredOrigin(runtime, environmentName, developmentFallback)
  if (!origin) return unavailable(environmentName)

  let target: URL
  try {
    target = new URL(`/${path ?? ''}`, `${origin}/`)
  } catch {
    return unavailable(environmentName)
  }
  target.search = new URL(request.url).search

  const headers = new Headers(request.headers)
  for (const header of hopByHopHeaders) headers.delete(header)
  headers.delete('host')
  headers.delete('content-length')

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      // Node's fetch needs this when streaming a request body through a server route.
      ...(request.body ? { duplex: 'half' as never } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    const responseHeaders = new Headers(response.headers)
    for (const header of hopByHopHeaders) responseHeaders.delete(header)
    responseHeaders.set('cache-control', 'no-store')
    return new Response(response.body, { status: response.status, headers: responseHeaders })
  } catch {
    return Response.json({ error: `${environmentName} is temporarily unavailable. Retry shortly.` }, {
      status: 502,
      headers: { 'cache-control': 'no-store' },
    })
  }
}

export function runtimeEnvironment(locals: unknown): RuntimeEnv {
  return (locals as { runtime?: { env?: RuntimeEnv } }).runtime?.env ?? {}
}
