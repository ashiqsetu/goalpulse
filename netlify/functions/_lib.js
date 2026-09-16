export const API_SPORTS_BASE = 'https://v3.football.api-sports.io'

// Limits of the free plan (10 req/min, 100 req/day) make caching essential.
export const TTL_SECONDS = {
  fixtures: 60,          // live scores change often
  predictions: 6 * 3600, // pre-match analysis, rarely changes
  odds: 1800,
  standings: 24 * 3600,
  teams: 7 * 24 * 3600,
  players: 24 * 3600,
  h2h: 3600,
}

// Parses a v3.football.api-sports.io endpoint path like
// "fixtures?date=2026-09-16" into { base: "fixtures", params: {...} }
export function parseEndpoint(raw) {
  const [base, qs] = String(raw || '').split('?')
  const params = {}
  if (qs) {
    for (const pair of qs.split('&')) {
      const [k, v] = pair.split('=')
      if (k && v !== undefined) params[decodeURIComponent(k)] = decodeURIComponent(v)
    }
  }
  return { base, params }
}

export function ttlFor(base) {
  return TTL_SECONDS[base] ?? 300
}
