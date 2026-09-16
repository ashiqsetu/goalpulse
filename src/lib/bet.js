// Pure functions for the Bet Builder.

export const OUTCOMES = ['H', 'D', 'A']
export const OUTCOME_LABEL = { H: 'Home win', D: 'Draw', A: 'Away win' }

// Convert API odds to implied probability (0..1)
export function impliedProb(odd) {
  const o = parseFloat(odd)
  if (!o || o <= 1) return 0
  return 1 / o
}

// Best (highest) odds per outcome across bookmakers.
export function bestOdds(oddsResponse) {
  const out = { H: null, D: null, A: null }
  const bookmakers = Array.isArray(oddsResponse) ? oddsResponse : []
  for (const b of bookmakers) {
    for (const bet of b.bets || []) {
      if (bet.id !== 1 && bet.name !== 'Match Winner') continue
      for (const v of bet.values || []) {
        const key = v.value === 'Home' ? 'H' : v.value === 'Draw' ? 'D' : v.value === 'Away' ? 'A' : null
        if (!key) continue
        const odd = parseFloat(v.odd)
        if (!out[key] || odd > parseFloat(out[key].odd)) out[key] = v
      }
    }
  }
  return out
}

// Win percentages per outcome (0..1). Priority: prediction percent field, then odds.
export function winPercentages(prediction, odds) {
  const p = prediction?.predictions?.percent || {}
  const pct = (s) => {
    const n = parseFloat(String(s || '').replace('%', ''))
    return Number.isFinite(n) ? n / 100 : 0
  }
  let H = pct(p.home), D = pct(p.draw), A = pct(p.away)
  if (!H && !D && !A) {
    const bo = bestOdds(odds)
    H = impliedProb(bo.H?.odd)
    D = impliedProb(bo.D?.odd)
    A = impliedProb(bo.A?.odd)
    const sum = H + D + A
    if (sum > 0) { H /= sum; D /= sum; A /= sum }
  }
  return { H, D, A }
}

// Most likely outcome: 'H' | 'D' | 'A'
export function favoriteOutcome(wp) {
  return wp.H >= wp.D && wp.H >= wp.A ? 'H' : wp.A >= wp.D ? 'A' : 'D'
}

// Fallback historical head-to-head distribution (used when no prediction/odds).
export function h2hDistribution(h2hFixtures, _homeId, _awayId) {
  const c = { H: 0, D: 0, A: 0 }
  for (const f of h2hFixtures || []) {
    if (!isFinished(f)) continue
    if (f.goals.home > f.goals.away) c.H++
    else if (f.goals.home < f.goals.away) c.A++
    else c.D++
  }
  const total = c.H + c.D + c.A
  if (!total) return null
  // historical fixtures store teams as [home, away] of that game — but the
  // caller passes current pairing; approximate by event order
  return { H: c.H / total, D: c.D / total, A: c.A / total }
}

export function isFinished(f) {
  return ['FT', 'AET', 'PEN'].includes(f?.status?.short)
}

// Accumulator product of decimal odds.
export function accOdds(oddsList) {
  return (oddsList || []).reduce((acc, o) => acc * (parseFloat(o) || 0), 1)
}

// Core Bet Builder math:
// matches: [{ label, home, away, wp: {H,D,A}, odds: {H:{odd},D:{odd},A:{odd}} }]
// pickPerMatch: outcome key per match (or null for open)
// pickAll: boolean — count only combos where every pick is correct
// minCorrect: minimum number of picks that must be correct (for pickAll=false)
export function analyze(matches, pickPerMatch, pickAll, minCorrect) {
  const n = matches.length
  const total = Math.pow(3, n)

  // Enumerate all combinations, score each.
  const combos = []
  for (let mask = 0; mask < total; mask++) {
    let m = mask
    const picks = []
    for (let i = 0; i < n; i++) {
      picks.push(OUTCOMES[m % 3])
      m = Math.floor(m / 3)
    }
    let prob = 1
    let oddsAcc = 1
    let correct = 0
    for (let i = 0; i < n; i++) {
      const k = picks[i]
      prob *= matches[i].wp[k] || 0
      oddsAcc *= parseFloat(matches[i].odds[k]?.odd) || 0
      if (pickPerMatch[i] && k === pickPerMatch[i]) correct++
    }
    const passes = pickAll
      ? correct === n
      : correct >= Math.min(minCorrect ?? 1, n)
    combos.push({ picks, prob, odds: oddsAcc, correct, passes })
  }

  const passing = combos.filter((c) => c.passes)
  const totalProb = passing.reduce((s, c) => s + c.prob, 0)
  const best = passing.reduce((b, c) => (!b || c.odds > b.odds ? c : b), null)
  const cheapest = passing.reduce((b, c) => (!b || c.odds < b.odds ? c : b), null)
  const safest = passing.reduce((b, c) => (!b || c.prob > b.prob ? c : b), null)

  return {
    totalCombos: total,
    passingCount: passing.length,
    chance: totalProb,           // probability at least one passing combo hits
    best,                        // highest combined odds
    cheapest,                    // cheapest way to cover (lowest combined odds)
    safest,                      // most likely single combo
    combos: passing
      .slice()
      .sort((a, b) => b.prob - a.prob),
  }
}

// Human-readable "how to win" description for a set of picks.
export function describePlan(matches, picks) {
  const parts = matches.map((m, i) => {
    const k = picks[i]
    const team = k === 'H' ? m.home.name : k === 'A' ? m.away.name : null
    return k === 'D' ? `${m.home.name} vs ${m.away.name}: draw` : `${m.home.name} vs ${m.away.name}: ${team} win`
  })
  return parts.join(' · ')
}
