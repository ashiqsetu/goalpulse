import { parseEndpoint, ttlFor } from './_lib.js'
import { cacheGet, cacheSet, cacheGetStale, pruneExpired } from './_cache.js'
import { consumeQuota, quotaSnapshot } from './_quota.js'
import {
  fdMatchToFixture, fdStandingsToApp, fdTeamToApp, fdGet,
  indexMatches, lookupMatch, lookupTeamCompetitions, codeFromLegacyId,
  competitionByCode, competitionById, applyDerivedSplits,
} from './_fd.js'
import { expectedGoals, matchModel, fairOdds, pctStr } from './_model.js'

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  })

const empty = (errors) => ({ results: 0, response: [], errors: errors || {} })

const ALLOWED = new Set([
  'fixtures', 'fixtures/headtohead', 'predictions', 'odds', 'standings',
  'teams', 'players',
])

// Top leagues scanned when the fixture-id index can't locate a match/pair yet.
const FALLBACK_CODES = ['PL', 'PD', 'SA', 'BL1', 'FL1', 'CL']

// Cache keys double as Netlify Blobs keys, and blob keys are URL path
// segments: `?`, `&` and `=` in a key are parsed as a query string and
// dropped, which collapsed every standings league (and every fixture date,
// h2h pair, team, prediction) onto ONE cached payload — the first league
// fetched was served for all of them until the TTL expired. Percent-encode
// the params so each variant gets its own blob under a single path segment.
const canonical = (base, params) => {
  const qs = new URLSearchParams(Object.entries(params).sort()).toString()
  return qs ? `${base}@${encodeURIComponent(qs)}` : base
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, {})

  const url = new URL(req.url)

  // Status endpoint: quota diagnostics, costs nothing.
  // /api/fetch?ep=__status
  if (url.searchParams.get('ep') === '__status') {
    return json(200, { quota: await quotaSnapshot(), provider: 'football-data.org v4' })
  }

  const endpoint = url.searchParams.get('ep')
  if (!endpoint) {
    return json(400, { error: 'Missing ?ep=endpoint e.g. /api/fetch?ep=fixtures?date=2026-09-16' })
  }

  const { base, params } = parseEndpoint(endpoint)
  if (!ALLOWED.has(base)) {
    return json(400, { error: `Endpoint "${base}" is not allowed` })
  }

  // Parameters that must not change the cache key (the upstream plan serves
  // the current season regardless; the frontend still sends them).
  if (base === 'standings' || base === 'teams') delete params.season

  const apiKey =
    process.env.FOOTBALL_DATA_API_KEY || process.env.V3_FOOTBALL_API_KEY || ''
  if (!apiKey) {
    return json(500, {
      error: 'Server misconfigured: FOOTBALL_DATA_API_KEY is not set. Add it in Netlify (Site configuration → Environment variables) and redeploy.',
    })
  }

  const key = canonical(base, params)

  // Cache lookup: memory L1 + Netlify Blobs L2 (survives cold starts).
  const hit = await cacheGet(key)
  if (hit && hit.fresh) {
    return json(200, { ...hit.payload, _cached: true })
  }

  // Request budget: consume one unit only when about to call upstream.
  if ((await consumeQuota()) === 'blocked') {
    const stale = hit && hit.stale ? hit.payload : await cacheGetStale(key)
    if (stale) return json(200, { ...stale, _cached: true, _stale: true })
    return json(429, {
      error: 'Daily API budget reached — fresh data returns tomorrow (UTC).',
    })
  }

  let payload
  try {
    payload = await route(base, params, apiKey)
  } catch (e) {
    // Upstream hiccup: serve stale cache before failing.
    const stale = await cacheGetStale(key)
    if (stale) return json(200, { ...stale, _cached: true, _stale: true })
    if (e?.status === 429) {
      const retryAfter = Math.max(1, Math.min(60, Number(e?.retryAfter) || 60))
      return new Response(
        JSON.stringify({
          error: 'Upstream rate limit reached (10 req/min on the free plan) — data is cached, try again shortly.',
          retryable: true,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Retry-After': String(retryAfter),
          },
        },
      )
    }
    if (e?.status === 403 || e?.status === 404) {
      // Plan restriction / unknown resource → app-shaped empty so the
      // frontend's planError() handling and fallbacks kick in.
      return json(200, empty({ plan: 'Not available on the current data plan.' }))
    }
    return json(502, { error: e?.message || 'Upstream error' })
  }

  let ttl = ttlFor(base)
  // Degraded standings (no splits/form derivable) must not stick around —
  // let the next request re-derive once the upstream throttle window clears.
  if (payload?._noSplits) ttl = 90
  await cacheSet(key, payload, ttl)
  pruneExpired().catch(() => {})
  return json(200, payload)
}

// ------------------------------------------------------------------- routes

async function route(base, params, apiKey) {
  switch (base) {
    case 'fixtures': return handleFixtures(params, apiKey)
    case 'fixtures/headtohead': return handleH2H(params, apiKey)
    case 'standings': return handleStandings(params, apiKey)
    case 'teams': return handleTeams(params, apiKey)
    case 'predictions': return handlePredictions(params, apiKey)
    case 'odds': return handleOdds(params, apiKey)
    case 'players':
      return empty({ plan: 'Player statistics are not available on the current data plan.' })
    default: return empty()
  }
}

// Season list per competition, cache-backed. football-data.org serves the
// current season when no ?season= is passed, for every calendar (European,
// Brazilian, tournaments). This is also what fills the fixture-id index.
async function getSeasonMatches(code, apiKey) {
  const ck = `fdseason:${code}`
  const hit = await cacheGet(ck)
  if (hit && hit.payload?.matches) {
    indexMatches(hit.payload.matches).catch(() => {})
    return hit.payload.matches
  }
  const j = await fdGet(`competitions/${code}/matches`, apiKey)
  const matches = j.matches || []
  await cacheSet(ck, { matches }, ttlFor('fixtures/season'))
  await indexMatches(matches)
  return matches
}

async function handleFixtures(params, apiKey) {
  // Single fixture by id — the free plan has no /matches/{id}, so resolve
  // through the id index (filled by every list response we ever fetch).
  if (params.id) {
    const id = Number(params.id)
    const loc = await lookupMatch(id)
    const codes = loc ? [loc.code] : FALLBACK_CODES
    for (const code of codes) {
      try {
        const m = (await getSeasonMatches(code, apiKey)).find((x) => x.id === id)
        if (m) return { results: 1, response: [fdMatchToFixture(m)] }
      } catch { /* next candidate */ }
    }
    return empty()
  }

  // Day list. The client sends its IANA timezone (tz) so "today" means the
  // visitor's calendar day: fetch a ±1-day UTC range upstream (1 request),
  // then filter to the local window.
  if (params.date) {
    const date = params.date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return empty({ date: 'Invalid date' })
    const win = localDayWindow(date, params.tz)
    const shift = (d) => new Date(Date.parse(date + 'T00:00:00Z') + d * 86400000).toISOString().slice(0, 10)
    const j = await fdGet('matches', apiKey, { dateFrom: shift(-1), dateTo: shift(1) })
    const matches = (j.matches || []).filter((m) => {
      const t = m.utcDate ? Date.parse(m.utcDate) : NaN
      return Number.isFinite(t) && t >= win.start && t < win.end
    })
    await indexMatches(matches)
    const fixtures = matches.map(fdMatchToFixture)
    return { results: fixtures.length, response: fixtures }
  }

  // Team schedule (TeamPage): fd serves the team's matches across all its
  // TIER_ONE competitions; two calls cover upcoming + finished.
  if (params.team) {
    const tid = Number(params.team)
    const [sched, fin] = await Promise.all([
      fdGet(`teams/${tid}/matches`, apiKey, { status: 'SCHEDULED', limit: '50' }),
      fdGet(`teams/${tid}/matches`, apiKey, { status: 'FINISHED', limit: '50' }),
    ])
    const all = [...(sched.matches || []), ...(fin.matches || [])]
    await indexMatches(all)
    const fixtures = all.map(fdMatchToFixture)
    return { results: fixtures.length, response: fixtures }
  }

  return empty()
}

// Head-to-head: no upstream endpoint — filter season lists for the pair.
async function handleH2H(params, apiKey) {
  const m = String(params.h2h || '').match(/^(\d+)-(\d+)$/)
  if (!m) return empty({ h2h: 'Expected h2h=id-id' })
  const a = Number(m[1])
  const b = Number(m[2])

  const isPair = (x) => {
    const h = x?.homeTeam?.id
    const w = x?.awayTeam?.id
    return (h === a && w === b) || (h === b && w === a)
  }

  // Competitions the teams are known to play (from the index), else the big five + CL.
  const [knownA, knownB] = await Promise.all([
    lookupTeamCompetitions(a), lookupTeamCompetitions(b),
  ])
  const known = [...new Set([...knownA, ...knownB])]
  const codes = known.length ? known : FALLBACK_CODES
  for (const code of codes) {
    try {
      const hits = (await getSeasonMatches(code, apiKey)).filter(isPair)
      if (hits.length) {
        return { results: hits.length, response: hits.map(fdMatchToFixture) }
      }
    } catch { /* next candidate */ }
  }
  return empty()
}

export { handleStandings }

// One match page fires standings three times (table + predictions + odds).
// A 60s in-process memo of the raw upstream payload collapses those to a
// single upstream call on warm instances; the Blobs cache covers cold ones.
const stMemo = new Map() // code -> { at, j }
const ST_MEMO_MS = 60_000
async function getStandingsRaw(code, apiKey) {
  const hit = stMemo.get(code)
  if (hit && Date.now() - hit.at < ST_MEMO_MS) return hit.j
  const j = await fdGet(`competitions/${code}/standings`, apiKey)
  stMemo.set(code, { at: Date.now(), j })
  return j
}

async function handleStandings(params, apiKey) {
  const comp = competitionByCode(params.league) || competitionById(params.league)
  if (!comp) return empty({ league: 'Unknown league' })
  const j = await getStandingsRaw(comp.code, apiKey)
  const app = fdStandingsToApp(j, comp.code)
  // The free plan's standings are TOTAL-only (no HOME/AWAY nodes, form null).
  // Derive splits + last-5 form from the cached season match list.
  try {
    const matches = await getSeasonMatches(comp.code, apiKey)
    for (const rows of app?.response?.[0]?.league?.standings || []) {
      applyDerivedSplits(rows, matches)
    }
  } catch {
    // Throttled while fetching the match list: fall back to the stale season
    // list so the table still gets splits/form. If no stale copy exists the
    // payload is marked degraded — the handler then caches it briefly instead
    // of baking zeroed home/away tabs in for the full 12h TTL.
    let matches = []
    try {
      const stale = await cacheGetStale(`fdseason:${comp.code}`)
      matches = stale?.matches || []
    } catch { /* stay empty */ }
    for (const rows of app?.response?.[0]?.league?.standings || []) {
      applyDerivedSplits(rows, matches)
    }
    if (!matches.length) app._noSplits = true
  }
  return app
}

async function handleTeams(params, apiKey) {
  if (!params.id) return empty({ team: 'Missing team id' })
  const j = await fdGet(`teams/${Number(params.id)}`, apiKey)
  return fdTeamToApp(j)
}

// ------------------------------------------------------- model predictions

// Resolve a fixture through the id path, then find both teams' league rows.
async function modelContext(params, apiKey) {
  const fxRes = await handleFixtures({ id: params.fixture }, apiKey)
  const fx = fxRes?.response?.[0]
  if (!fx) return null
  const loc = await lookupMatch(fx.fixture.id)
  const code = loc?.code || codeFromLegacyId(fx.league.id)
  let rows = []
  if (code) {
    const st = await handleStandings({ league: code }, apiKey)
    rows = st?.response?.[0]?.league?.standings?.[0] || []
  }
  return {
    fx,
    rowH: rows.find((r) => r.team.id === fx.teams.home.id) || null,
    rowA: rows.find((r) => r.team.id === fx.teams.away.id) || null,
  }
}

const formPoints = (row) => {
  const f = row?.form || ''
  return (f.match(/W/g) || []).length * 3 + (f.match(/D/g) || []).length
}
const share = (x, y) => {
  const s = (x || 0) + (y || 0)
  if (s <= 0) return { home: 50, away: 50 }
  const h = Math.round((x / s) * 100)
  return { home: h, away: 100 - h }
}

async function handlePredictions(params, apiKey) {
  const ctx = await modelContext(params, apiKey)
  if (!ctx) return empty({ fixture: 'Fixture not found or not yet indexed' })
  const { fx, rowH, rowA } = ctx

  const { lh, la, h, a } = expectedGoals(rowH, rowA)
  const m = matchModel(lh, la)
  const percent = { home: pctStr(m.H), draw: pctStr(m.D), away: pctStr(m.A) }
  const fav = m.H >= m.D && m.H >= m.A ? 'H' : m.A >= m.D ? 'A' : 'D'
  const favName = fav === 'H' ? fx.teams.home.name : fav === 'A' ? fx.teams.away.name : 'Draw'
  const advice =
    fav === 'D'
      ? `Model estimate: draw most likely (${percent.draw}) · expected goals ${lh.toFixed(1)}–${la.toFixed(1)}`
      : `Model estimate: ${favName} win ${percent[fav]} · expected goals ${lh.toFixed(1)}–${la.toFixed(1)}`

  return {
    results: 1,
    response: [{
      teams: {
        home: { id: fx.teams.home.id, name: fx.teams.home.name, logo: fx.teams.home.logo, last_5: { form: h.form } },
        away: { id: fx.teams.away.id, name: fx.teams.away.name, logo: fx.teams.away.logo, last_5: { form: a.form } },
      },
      comparison: {
        form: share(formPoints(rowH), formPoints(rowA)),
        att: share(h.att, a.att),
        def: share(a.def ? 1 / a.def : 1, h.def ? 1 / h.def : 1), // lower = tighter defence
        poisson_distribution: share(m.H, m.A),
        h2h: { home: 50, away: 50 },
        total: share(h.att / (a.def || 1), a.att / (h.def || 1)),
      },
      predictions: {
        winner: { id: fav === 'A' ? fx.teams.away.id : fx.teams.home.id, name: favName, comment: 'Model estimate' },
        percent,
        advice,
        goals: { home: lh.toFixed(1), away: la.toFixed(1) },
      },
    }],
  }
}

async function handleOdds(params, apiKey) {
  const ctx = await modelContext(params, apiKey)
  if (!ctx) return empty({ fixture: 'Fixture not found or not yet indexed' })
  const { fx, rowH, rowA } = ctx

  const { lh, la } = expectedGoals(rowH, rowA)
  const m = matchModel(lh, la)

  // api-sports odds shape — bestOdds() in the frontend reads exactly this.
  return {
    results: 1,
    response: [{
      fixture: { id: fx.fixture.id },
      bookmakers: [{
        id: 0,
        name: 'GoalPulse model (estimate)',
        bets: [{
          id: 1,
          name: 'Match Winner',
          values: [
            { value: 'Home', odd: fairOdds(m.H) },
            { value: 'Draw', odd: fairOdds(m.D) },
            { value: 'Away', odd: fairOdds(m.A) },
          ],
        }],
      }],
    }],
  }
}

// ------------------------------------------------------------ tz day window

// Offset (ms) of tz at instant ms: "time shown in tz" − UTC time.
function tzOffsetMs(ms, tz) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const p = {}
    for (const { type, value } of dtf.formatToParts(new Date(ms))) p[type] = value
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
    return asUTC - ms
  } catch { return 0 }
}

// [start, end) UTC instants of local calendar day `date` in tz.
function localDayWindow(date, tz) {
  const guess = Date.parse(date + 'T00:00:00Z')
  if (!Number.isFinite(guess) || !tz) {
    const start = Number.isFinite(guess) ? guess : Date.now()
    return { start, end: start + 86400000 }
  }
  const startOfDay = (d) => {
    const g = Date.parse(d + 'T00:00:00Z')
    const off = tzOffsetMs(g, tz)
    let s = g - off
    const off2 = tzOffsetMs(s, tz)
    if (off2 !== off) s = g - off2
    return s
  }
  const next = new Date(guess + 86400000).toISOString().slice(0, 10)
  return { start: startOfDay(date), end: startOfDay(next) }
}

export const config = { path: '/api/fetch' }
