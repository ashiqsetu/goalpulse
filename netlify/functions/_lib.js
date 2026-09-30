// Shared constants + helpers for the GoalPulse function.
// Data provider: football-data.org v4 (free TIER_ONE plan).

// Cache lifetimes tuned to the free plan (10 req/min upstream):
export const TTL_SECONDS = {
  fixtures: 60,            // day lists / live scores
  'fixtures/season': 6 * 3600,   // full competition season list (fixture-id lookups, h2h)
  'fixtures/h2h': 6 * 3600,
  standings: 12 * 3600,
  teams: 7 * 24 * 3600,
  predictions: 3 * 3600,   // model output is deterministic on standings — long TTL is safe
  odds: 3 * 3600,
  players: 24 * 3600,
}

export function ttlFor(base) {
  return TTL_SECONDS[base] ?? 300
}

// Parses "fixtures?date=2026-09-16" into { base: "fixtures", params: {...} }
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

export const todayUTC = () => new Date().toISOString().slice(0, 10)
