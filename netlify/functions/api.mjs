import { API_SPORTS_BASE, parseEndpoint, ttlFor } from './_lib.js'

// Memory cache survives between warm invocations on the same instance.
// (Netlify also persists responses in .netlify/cache where available.)
const memory = new Map() // key -> { expires, payload }

function cacheGet(key) {
  const hit = memory.get(key)
  if (!hit) return null
  if (Date.now() > hit.expires) {
    memory.delete(key)
    return null
  }
  return hit.payload
}

function cacheSet(key, payload, ttl) {
  memory.set(key, { expires: Date.now() + ttl * 1000, payload })
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

export default async (req) => {
  const url = new URL(req.url)
  const endpoint = url.searchParams.get('ep')

  if (!endpoint) {
    return json(400, { error: 'Missing ?ep=endpoint e.g. /api/fetch?ep=fixtures?date=2026-09-16' })
  }

  const { base, params } = parseEndpoint(endpoint)

  // Only allow known, safe endpoints — never expose the key to the client.
  const allowed = new Set([
    'fixtures',
    'fixtures/headtohead',
    'predictions',
    'odds',
    'standings',
    'teams',
    'players',
  ])
  if (!allowed.has(base)) {
    return json(400, { error: `Endpoint "${base}" is not allowed` })
  }

  const key = base + '?' + new URLSearchParams(params).toString()
  const cached = cacheGet(key)
  if (cached) {
    return json(200, { ...cached, _cached: true })
  }

  const upstream = new URLSearchParams(params)
  const res = await fetch(`${API_SPORTS_BASE}/${base}?${upstream.toString()}`, {
    headers: { 'x-apisports-key': process.env.V3_FOOTBALL_API_KEY || '' },
  })

  let payload
  try {
    payload = await res.json()
  } catch {
    return json(502, { error: 'Upstream returned invalid JSON' })
  }

  const errors = payload && payload.errors
  const hasErrors = errors && !Array.isArray(errors)
    ? Object.keys(errors).length > 0
    : Array.isArray(errors) ? errors.length > 0 : false

  if (!res.ok || hasErrors) {
    // Pass through plan/rate errors but keep status 200-ish for the client
    // to render friendly messages.
    return json(200, {
      results: 0,
      response: [],
      errors: (payload && payload.errors) || { upstream: `HTTP ${res.status}` },
    })
  }

  cacheSet(key, payload, ttlFor(base))
  return json(200, payload)
}

export const config = { path: '/api/fetch' }
