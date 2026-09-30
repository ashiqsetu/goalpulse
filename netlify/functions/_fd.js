// football-data.org v4 → GoalPulse translation layer.
// The frontend keeps speaking the api-sports response dialect it was built on
// (fixtures/standings/teams with the same node names); every upstream response
// is normalized here so pages don't change their data access.
import { getStore } from '@netlify/blobs'

export const FD_BASE = 'https://api.football-data.org/v4'

// The free "TIER_ONE" plan serves exactly these 13 competitions. The app uses
// stable string codes (football-data has no integer league ids), so the old
// numeric api-sports league ids are mapped here to keep stored data valid.
export const FD_COMPETITIONS = [
  { code: 'PL',  id: 39,   name: 'Premier League',           country: 'England', emblem: 'https://crests.football-data.org/PL.svg' },
  { code: 'PD',  id: 140,   name: 'Primera Division',         country: 'Spain',   emblem: 'https://crests.football-data.org/PD.svg' },
  { code: 'SA',  id: 135,   name: 'Serie A',                  country: 'Italy',   emblem: 'https://crests.football-data.org/SA.svg' },
  { code: 'BL1', id: 78,    name: 'Bundesliga',               country: 'Germany', emblem: 'https://crests.football-data.org/BL1.svg' },
  { code: 'FL1', id: 61,    name: 'Ligue 1',                  country: 'France',  emblem: 'https://crests.football-data.org/FL1.svg' },
  { code: 'CL',  id: 2,     name: 'UEFA Champions League',    country: 'World',   emblem: 'https://crests.football-data.org/CL.svg' },
  { code: 'DED', id: 88,    name: 'Eredivisie',               country: 'Netherlands', emblem: 'https://crests.football-data.org/DED.svg' },
  { code: 'PPL', id: 94,    name: 'Primeira Liga',            country: 'Portugal', emblem: 'https://crests.football-data.org/PPL.svg' },
  { code: 'ELC', id: 40,    name: 'Championship',             country: 'England', emblem: 'https://crests.football-data.org/ELC.svg' },
  { code: 'BSA', id: 71,    name: 'Campeonato Brasileiro Série A', country: 'Brazil', emblem: 'https://crests.football-data.org/BSA.svg' },
  { code: 'CLI', id: 13,    name: 'Copa Libertadores',        country: 'World',   emblem: 'https://crests.football-data.org/CLI.svg' },
  { code: 'WC',  id: 1,     name: 'FIFA World Cup',           country: 'World',   emblem: 'https://crests.football-data.org/WC.svg' },
  { code: 'EC',  id: 4,     name: 'European Championship',    country: 'Europe',  emblem: 'https://crests.football-data.org/EC.svg' },
]

const BY_ID = new Map(FD_COMPETITIONS.map((c) => [c.id, c]))
const BY_CODE = new Map(FD_COMPETITIONS.map((c) => [c.code, c]))
const CODE_BY_ID = new Map(FD_COMPETITIONS.map((c) => [c.id, c.code]))

export const competitionByCode = (code) => BY_CODE.get(String(code || '').toUpperCase()) || null
export const competitionById = (id) => BY_ID.get(Number(id)) || null
export const codeFromLegacyId = (id) => CODE_BY_ID.get(Number(id)) || null

// ---------------------------------------------------------------- mapping

const STATUS_MAP = {
  SCHEDULED: { short: 'NS', long: 'Not Started' },
  TIMED:     { short: 'NS', long: 'Time To Be Defined' },
  IN_PLAY:   { short: '2H', long: 'In Play' },
  PAUSED:    { short: 'HT', long: 'Halftime' },
  LIVE:      { short: '2H', long: 'Live' },
  FINISHED:  { short: 'FT', long: 'Match Finished' },
  POSTPONED: { short: 'PST', long: 'Postponed' },
  SUSPENDED: { short: 'INT', long: 'Suspended' },
  CANCELLED: { short: 'CANC', long: 'Cancelled' },
  AWARDED:   { short: 'AWD', long: 'Technical Loss' },
}
export const mapStatus = (s) => STATUS_MAP[s] || { short: s || 'NS', long: s || 'Unknown' }

const teamNode = (t = {}) => ({
  id: t.id ?? 0,
  name: t.shortName || t.name || 'Unknown',
  logo: t.crest || '',
  winner: null,
  // extra fields the app can use
  fullName: t.name,
  tla: t.tla || '',
})

// One football-data match → the api-sports fixture shape the app renders.
export function fdMatchToFixture(m = {}) {
  const status = mapStatus(m.status)
  const comp = m.competition || {}
  const mapped = competitionByCode(comp.code)
  const score = m.score || {}
  const ft = score.fullTime || {}
  const ht = score.halfTime || {}
  const started = status.short !== 'NS'
  return {
    fixture: {
      id: m.id,
      referee: null,
      timezone: 'UTC',
      date: m.utcDate,
      timestamp: m.utcDate ? Math.floor(new Date(m.utcDate).getTime() / 1000) : null,
      status: { long: status.long, short: status.short, elapsed: status.short === 'HT' ? 45 : null },
    },
    league: {
      id: mapped?.id ?? comp.id ?? 0,
      name: comp.name || mapped?.name || 'Competition',
      country: mapped?.country || comp.area?.name || '',
      logo: mapped?.emblem || comp.emblem || '',
      flag: null,
      season: m.season?.startDate ? Number(m.season.startDate.slice(0, 4)) : null,
      round: m.matchday != null ? `Regular Season - ${m.matchday}` : (m.stage || ''),
    },
    teams: {
      home: teamNode(m.homeTeam),
      away: teamNode(m.awayTeam),
    },
    goals: {
      home: started ? (ft.home ?? null) : null,
      away: started ? (ft.away ?? null) : null,
    },
    score: {
      halftime: { home: ht.home ?? null, away: ht.away ?? null },
      fulltime: { home: ft.home ?? null, away: ft.away ?? null },
    },
  }
}

// ------------------------------------------------- fixture id → match index

// The free tier cannot fetch a single match by id, so every list response is
// indexed (fixture id → { code, season }) in a Blobs store. Fixture pages,
// team pages and bet grading resolve their matches through this index.
const INDEX_STORE = 'gp-cache'
const INDEX_KEY = 'fd-match-index'
const TEAM_KEY = 'fd-team-index'

let indexPromise = null
let teamIndexPromise = null

async function loadIndex() {
  if (!indexPromise) {
    indexPromise = (async () => {
      try {
        const s = getStore({ name: INDEX_STORE })
        const raw = await s.get(INDEX_KEY, { type: 'json' })
        return raw && typeof raw === 'object' ? raw : {}
      } catch {
        return {}
      }
    })()
  }
  return indexPromise
}

async function loadTeamIndex() {
  if (!teamIndexPromise) {
    teamIndexPromise = (async () => {
      try {
        const s = getStore({ name: INDEX_STORE })
        const raw = await s.get(TEAM_KEY, { type: 'json' })
        return raw && typeof raw === 'object' ? raw : {}
      } catch {
        return {}
      }
    })()
  }
  return teamIndexPromise
}

// Which TIER_ONE competitions has this team been seen playing in?
export async function lookupTeamCompetitions(teamId) {
  try {
    const t = (await loadTeamIndex())[String(teamId)]
    return t && Array.isArray(t.codes) ? t.codes : []
  } catch {
    return []
  }
}

// Record where a batch of matches lives so /fixtures?id=… can find them later.
export async function indexMatches(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return
  try {
    const [idx, teams] = await Promise.all([loadIndex(), loadTeamIndex()])
    const now = Date.now()
    for (const m of matches) {
      if (!m?.id || !m?.competition?.code || !m?.season?.startDate) continue
      idx[String(m.id)] = {
        code: m.competition.code,
        season: Number(m.season.startDate.slice(0, 4)),
        at: now,
      }
      // Remember team → competitions for h2h narrowing.
      for (const side of ['homeTeam', 'awayTeam']) {
        const tid = m[side]?.id
        if (!tid) continue
        const entry = teams[String(tid)] || { codes: [], at: 0 }
        if (!entry.codes.includes(m.competition.code)) entry.codes.push(m.competition.code)
        entry.at = now
        teams[String(tid)] = entry
      }
    }
    const s = getStore({ name: INDEX_STORE })
    const writes = [s.setJSON(INDEX_KEY, idx)]
    // Keep the team index bounded too (drop least-recently-seen past 3000).
    const tKeys = Object.keys(teams)
    if (tKeys.length > 3000) {
      tKeys.sort((a, b) => (teams[a].at || 0) - (teams[b].at || 0))
      for (const k of tKeys.slice(0, tKeys.length - 3000)) delete teams[k]
    }
    writes.push(s.setJSON(TEAM_KEY, teams))
    await Promise.all(writes)
  } catch { /* indexing is best-effort */ }
}

export async function lookupMatch(id) {
  const idx = await loadIndex()
  return idx[String(id)] || null
}

// ------------------------------------------------------------- translations

// competition/{code}/standings → api-sports standings shape (one league node
// whose .standings array holds TOTAL/HOME/AWAY tables — the app's StandingsPage
// renders the first table and MatchDetailPage reads rows from it).
export function fdStandingsToApp(fd, code) {
  const comp = competitionByCode(code)
  const leagueRow = fd?.standings?.find?.((s) => s.type === 'TOTAL') || fd?.standings?.[0]
  // "2026" for calendar-year seasons (Brazil), "2026/27" for European ones.
  const sy = fd?.season?.startDate ? Number(fd.season.startDate.slice(0, 4)) : null
  const ey = fd?.season?.endDate ? Number(fd.season.endDate.slice(0, 4)) : null
  const seasonLabel = sy && ey && ey === sy ? String(sy) : sy ? `${sy}/${String(sy + 1).slice(2)}` : null
  const toRow = (r) => ({
    rank: r.position,
    team: { id: r.team?.id, name: r.team?.shortName || r.team?.name, logo: r.team?.crest || '' },
    points: r.points,
    goalsDiff: r.goalDifference,
    group: r.group || (fd?.standings?.[0]?.group ? `Group ${fd.standings[0].group}` : null),
    // api-sports splits all/home/away per row; the app reads r.all / r.home / r.away
    all:   { played: r.playedGames, win: r.won, draw: r.draw, lose: r.lost, goals: { for: r.goalsFor, against: r.goalsAgainst } },
    home:  { played: 0, win: 0, draw: 0, lose: 0, goals: { for: 0, against: 0 } },
    away:  { played: 0, win: 0, draw: 0, lose: 0, goals: { for: 0, against: 0 } },
    // v4 form is a string like "W,L,W" (sometimes an array) — normalize to "WLW"
    form: Array.isArray(r.form)
      ? r.form.join('').slice(-5)
      : String(r.form || '').replace(/[^WDL]/gi, '').toUpperCase().slice(-5),
    // keep the raw form for the detail page
    _formRaw: Array.isArray(r.form) ? r.form.join(',') : String(r.form || ''),
    status: null,
    description: null,
    update: fd?.season?.utcLastUpdated || null,
  })

  const total = (leagueRow?.table || []).map(toRow)
  const home = fd?.standings?.find?.((s) => s.type === 'HOME')?.table || []
  const away = fd?.standings?.find?.((s) => s.type === 'AWAY')?.table || []
  // Merge home/away splits into the total rows by position.
  for (const r of total) {
    const h = home[r.rank - 1]
    const a = away[r.rank - 1]
    if (h) r.home = { played: h.playedGames, win: h.won, draw: h.draw, lose: h.lost, goals: { for: h.goalsFor, against: h.goalsAgainst } }
    if (a) r.away = { played: a.playedGames, win: a.won, draw: a.draw, lose: a.lost, goals: { for: a.goalsFor, against: a.goalsAgainst } }
  }

  return {
    results: total.length,
    response: [{
      league: {
        id: comp?.id ?? 0,
        name: fd?.competition?.name || comp?.name || code,
        country: comp?.country || fd?.competition?.area?.name || '',
        logo: comp?.emblem || fd?.competition?.emblem || '',
        flag: null,
        season: sy,
        _seasonLabel: seasonLabel,
        _currentMatchday: fd?.season?.currentMatchday ?? null,
        standings: [total],
      },
    }],
  }
}

// teams/{id} → the two-node api-sports shape TeamPage expects.
export function fdTeamToApp(fd) {
  const t = fd || {}
  return {
    results: 1,
    response: [{
      team: {
        id: t.id,
        name: t.shortName || t.name,
        logo: t.crest || '',
        code: t.tla || null,
        country: t.area?.name || null,
        founded: t.founded ?? null,
        national: false,
      },
      venue: t.venue
        ? { name: t.venue, city: t.address || '', capacity: null, surface: null }
        : null,
    }],
  }
}

// ------------------------------------------------------------- fd fetching

// Thin GET with the free plan's error surface translated to exceptions the
// router can act on (throttle → 429, forbidden → plan restrictions).
export async function fdGet(path, apiKey, query) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : ''
  const res = await fetch(`${FD_BASE}/${path}${qs}`, {
    headers: { 'X-Auth-Token': apiKey || '' },
  })
  if (res.status === 429) {
    const err = new Error('football-data.org rate limit hit (10 req/min on the free plan)')
    err.status = 429
    throw err
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.message || `football-data.org HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return body
}
