// Pure model math. The free football-data.org tier has no odds or predictions
// endpoints, so GoalPulse estimates them locally: each side's current league
// table is converted into attack/defence strengths (shrunk toward the league
// mean early in the season when samples are small), those strengths give
// expected goals for a Poisson score grid, and the grid yields win
// probabilities and over/under prices. Everything downstream (frontend, bet
// builder) consumes the same shapes it did before — the odds are labelled as
// model estimates, never as bookmaker prices.

export const LEAGUE_AVG_GOALS = 1.35 // baseline goals per team per game

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round2 = (x) => Math.round(x * 100) / 100

function poissonVec(lambda, maxN) {
  const v = []
  let p = Math.exp(-lambda)
  for (let k = 0; k <= maxN; k++) {
    v.push(k === 0 ? p : (p *= lambda / k))
  }
  const s = v.reduce((a, b) => a + b, 0) || 1
  return v.map((x) => x / s)
}

// Attack/defence multipliers for a team's league-table row (app shape:
// row.all.played, row.goals.for/against). k shrinks toward 1 with few games.
export function strengthFromRow(row, leagueAvg = LEAGUE_AVG_GOALS) {
  const played = row?.all?.played || 0
  const k = played / (played + 6)
  const gf = row ? (row.goals?.for || 0) / Math.max(1, played) : leagueAvg
  const ga = row ? (row.goals?.against || 0) / Math.max(1, played) : leagueAvg
  const att = k * (gf / leagueAvg) + (1 - k)
  const def = k * (ga / leagueAvg) + (1 - k)
  return { att: clamp(att, 0.3, 2.6), def: clamp(def, 0.3, 2.6), played, form: row?.form || '' }
}

// Expected goals for home/away from two table rows. 1.12 / 0.92 = home edge.
export function expectedGoals(rowH, rowA, leagueAvg = LEAGUE_AVG_GOALS) {
  const h = strengthFromRow(rowH, leagueAvg)
  const a = strengthFromRow(rowA, leagueAvg)
  const lh = clamp(leagueAvg * h.att * a.def * 1.12, 0.25, 3.6)
  const la = clamp(leagueAvg * a.att * h.def * 0.92, 0.2, 3.2)
  return { lh, la, h, a }
}

// Score-grid model → 1X2 probabilities + cumulative totals distribution.
// under[t] = P(total goals <= t), t up to maxN*2.
export function matchModel(lh, la, maxN = 10) {
  const ph = poissonVec(lh, maxN)
  const pa = poissonVec(la, maxN)
  const under = new Array(maxN * 2 + 1).fill(0)
  let H = 0, D = 0, A = 0
  for (let i = 0; i <= maxN; i++) {
    for (let j = 0; j <= maxN; j++) {
      const p = ph[i] * pa[j]
      const t = i + j
      for (let u = t; u < under.length; u++) under[u] += p
      if (i > j) H += p
      else if (i === j) D += p
      else A += p
    }
  }
  const s = H + D + A || 1
  return { H: H / s, D: D / s, A: A / s, under, lh, la, ph, pa }
}

// Fair decimal odd for probability p with a bookmaker-style overround margin.
export function fairOdds(p, margin = 1.06) {
  const odd = 1 / Math.max(1e-4, p * margin)
  return Math.max(1.01, round2(odd)).toFixed(2)
}

// Over/under prices for a .5 goal line (n = the integer below the line).
export function overUnderOdds(under, line) {
  const n = Math.floor(line)
  const u = clamp(under[n] ?? 0, 1e-4, 1 - 1e-4)
  return { under: fairOdds(u, 1.08), over: fairOdds(1 - u, 1.08) }
}

export const pctStr = (p) => `${Math.round((p || 0) * 100)}%`
