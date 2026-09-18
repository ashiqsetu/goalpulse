// Pure functions for the Bet Builder.

export const OUTCOMES = ['H', 'D', 'A']
export const OUTCOME_LABEL = { H: 'Home win', D: 'Draw', A: 'Away win' }
export const PICK_LABEL = {
  H: 'Win {home}',
  D: 'Draw',
  A: 'Win {away}',
  DC_H: 'Double chance: {home} or draw',
  DC_HA: 'Double chance: {home} or {away}',
  DC_D: 'Double chance: draw or {away}',
  OV: 'Over {n} goals',
  UN: 'Under {n} goals',
}
export const GOAL_LINES = [0.5, 1.5, 2.5, 3.5, 4.5]

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

// ------------------------------------------------------- Double chance / O-U

// The 1X2 market prices every single outcome, so the derived double-chance
// price is the sum of the two implied probabilities that make it up:
//   P(any of the two wins) = P(a) + P(b)  →  fair odd = 1 / (p_a + p_b)
// This is exactly how books derive 1X/12/X2; the free plan only serves the
// 1X2 market, so we compute the rest.
export function doubleChanceOdd(oddA, oddB) {
  const pa = impliedProb(oddA)
  const pb = impliedProb(oddB)
  const p = pa + pb
  if (p <= 0) return null
  const odd = 1 / p
  return Number.isFinite(odd) && odd > 1 ? odd.toFixed(2) : null
}

// True over/under odds need a goals model. Free plan has no odds lines, so we
// approximate the total-goals distribution with Poisson, using lambdas derived
// from the 1X2 prices (classic 3-outcome → strength decomposition).
export function totalsOdds(wp, bo) {
  const pH = wp.H || 0, pD = wp.D || 0, pA = wp.A || 0
  if (pH + pD + pA <= 0) return null
  // Fit home/away expected goals so that P(H)≈pH, P(D)≈pD, P(A)≈pA.
  // Standard approach: strength ratio from the favorite side, total goals from
  // the odds' overround-implied baseline. Keep it simple + monotonic.
  const avgGoals = 2.6
  const supp = () => {
    // Solve pair (lh, la) such that Poisson head-to-head probabilities match
    // the 1X2 distribution (least-squares grid search).
    let bestLh = 1.3, bestLa = 1.3, bestErr = Infinity
    for (let lh = 0.4; lh <= 3.4; lh += 0.1) {
      for (let la = 0.4; la <= 3.4; la += 0.1) {
        const h = poissonUpTo(lh, 8), a = poissonUpTo(la, 8)
        let eH = 0, eD = 0, eA = 0
        for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
          const p = h[i] * a[j]
          if (i > j) eH += p
          else if (i === j) eD += p
          else eA += p
        }
        const err = (eH - pH) ** 2 + (eD - pD) ** 2 + (eA - pA) ** 2
        if (err < bestErr) { bestErr = err; bestLh = lh; bestLa = la }
      }
    }
    return { lh: bestLh, la: bestLa }
  }
  const { lh, la } = supp()
  // Marginal totals: sum of two independent Poissons is Poisson(lh + la).
  const total = poissonUpTo(lh + la, 12)
  const out = {}
  for (const line of GOAL_LINES) {
    const n = Math.floor(line)
    let under = 0
    for (let k = 0; k <= n; k++) under += total[k] || 0
    const over = Math.max(1e-9, 1 - under)
    out[`OV_${n}`] = Math.max(1.01, 1 / over).toFixed(2)
    out[`UN_${n}`] = Math.max(1.01, 1 / Math.max(1e-9, under)).toFixed(2)
  }
  return out
}

function poissonUpTo(lambda, maxN) {
  const arr = []
  let p = Math.exp(-lambda)
  for (let k = 0; k <= maxN; k++) {
    arr.push(k === 0 ? p : (p = (p * lambda) / k))
  }
  // normalize (Poisson tail beyond maxN folded into the last bucket)
  const s = arr.reduce((a, b) => a + b, 0)
  return arr.map((v) => v / s)
}

// --------------------------------------------------------- Pick descriptions

// Matches PICK_LABEL templates to display names. pick: { k: 'H'|... , line: 3.5 }
export function pickText(pick, homeName, awayName) {
  if (!pick) return ''
  const m = {
    home: homeName,
    away: awayName,
    n: pick.line != null ? String(pick.line) : '',
  }
  return (PICK_LABEL[pick.k] || pick.k).replace(/\{(home|away|n)\}/g, (_, w) => m[w] ?? '')
}

// Short label for the leg chips: "W1", "X", "W2", "1X", "12", "X2", "O2.5", "U3.5"
export function pickShort(pick) {
  if (!pick) return ''
  const map = { H: 'W1', D: 'X', A: 'W2', DC_H: '1X', DC_HA: '12', DC_D: 'X2' }
  if (map[pick.k]) return map[pick.k]
  if (pick.k === 'OV') return `O${pick.line}`
  if (pick.k === 'UN') return `U${pick.line}`
  return pick.k
}

// Estimate probability of a pick from win% + derived totals.
export function pickProb(pick, wp, totals) {
  if (!pick) return 0
  if (pick.k === 'H') return wp.H || 0
  if (pick.k === 'D') return wp.D || 0
  if (pick.k === 'A') return wp.A || 0
  if (pick.k === 'DC_H') return (wp.H || 0) + (wp.D || 0)
  if (pick.k === 'DC_HA') return (wp.H || 0) + (wp.A || 0)
  if (pick.k === 'DC_D') return (wp.D || 0) + (wp.A || 0)
  if (pick.k === 'OV' || pick.k === 'UN') {
    const n = Math.floor(pick.line)
    const odd = totals?.[`OV_${n}`] || totals?.[`UN_${n}`]
    return odd ? impliedProb(odd) : 0
  }
  return 0
}

// Odds for a pick: real where the market exists, derived otherwise.
export function pickOdds(pick, bo, totals) {
  if (!pick) return null
  if (pick.k === 'H') return bo.H?.odd ?? null
  if (pick.k === 'D') return bo.D?.odd ?? null
  if (pick.k === 'A') return bo.A?.odd ?? null
  if (pick.k === 'DC_H') return doubleChanceOdd(bo.H?.odd, bo.D?.odd)
  if (pick.k === 'DC_HA') return doubleChanceOdd(bo.H?.odd, bo.A?.odd)
  if (pick.k === 'DC_D') return doubleChanceOdd(bo.D?.odd, bo.A?.odd)
  if (pick.k === 'OV' || pick.k === 'UN') {
    const n = Math.floor(pick.line)
    return totals?.[`${pick.k}_${n}`] ?? null
  }
  return null
}

// ------------------------------------------------------------- Variations

// Build the pick options shown per match: the 3 singles + the system's
// favourite-derived double chance + one over/under goal line.
export function pickOptionsFor(wp, totals, favorite) {
  const opts = [
    { k: 'H' }, { k: 'D' }, { k: 'A' },
    { k: 'DC_H' }, { k: 'DC_HA' }, { k: 'DC_D' },
  ]
  const line = suggestLine(wp, totals)
  if (line != null) {
    const n = Math.floor(line)
    const ov = totals?.[`OV_${n}`]
    const un = totals?.[`UN_${n}`]
    // expose the side the model believes more (higher implied prob)
    if (ov && un) {
      const ovP = impliedProb(ov), unP = impliedProb(un)
      opts.push(ovP >= unP ? { k: 'OV', line } : { k: 'UN', line })
    }
  }
  // Put the favourite first for UX
  const rank = { [favorite || 'H']: 0 }
  return opts.sort((a, b) => (rank[a.k] ?? 1) - (rank[b.k] ?? 1))
}

// Which goals line does the model suggest? The standard bookmaker line is 2.5;
// pickOptionsFor chooses the over/under side the model believes more.
export function suggestLine(_wp, totals) {
  return totals ? 2.5 : null
}

// Core variation engine for the multi-bet builder.
// matches: [{ id, label, home: {name}, away: {name}, wp, odds(bo), totals }]
// pickPerMatch: ({ k, line } | null) per match — null means "unpicked"
// optionsPerMatch: available pick options per match (for unpicked matches we
//                  enumerate every option)
// mode: 'picks' → one variation per combination of *picked* outcomes (a match
//       left unpicked contributes its most likely outcome);
//       'cover' → every combination of all options, so at least one wins.
export function buildVariations(matches, optionsPerMatch) {
  // optionsPerMatch is already resolved by the caller (mode + user picks).
  const perMatch = matches.map((_m, i) => optionsPerMatch[i] || [{ k: 'H' }])

  let combos = [{ picks: [] }]
  const exploded = []
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const opts = perMatch[i]
    const expanded = []
    for (const combo of combos) {
      for (const opt of opts) {
        const prob = pickProb(opt, m.wp, m.totals)
        // Real market odds where available; otherwise derive fair odds from the
        // estimated probability so the builder still works without odds data.
        const odd = parseFloat(pickOdds(opt, m.odds, m.totals))
          || (prob > 0 ? Math.max(1.01, 1 / prob) : 0)
        expanded.push({
          picks: [...combo.picks, opt],
          legOdds: [...combo.legOdds, odd],
          combinedOdds: combo.combinedOdds * (odd || 0),
          prob: combo.prob * prob,
        })
      }
    }
    exploded.push(m)
    combos = expanded
  }

  return { variations: combos, matches: exploded }
}

// Split a budget across variations so that *every* variation returns the same
// amount if it wins — the classic "dutching" allocation.
// Returns per-variation stakes; total may be a hair under budget due to rounding.
export function splitStake(variations, budget) {
  const inv = variations.map((v) => (v.combinedOdds > 1 ? 1 / v.combinedOdds : 0))
  const sum = inv.reduce((a, b) => a + b, 0)
  if (!sum || budget <= 0) return { stakes: variations.map(() => 0), equalReturn: 0, covered: false }
  // equal-return: stake_i = budget * (1/odds_i) / sum(1/odds)
  const raw = inv.map((x) => (budget * x) / sum)
  const stakes = raw.map((s) => Math.floor(s * 100) / 100) // cents
  const covered = stakes.every((s, i) => s > 0)
  const equalReturn = Math.min(
    ...stakes.map((s, i) => (s > 0 ? s * variations[i].combinedOdds : Infinity)),
  )
  const total = stakes.reduce((a, b) => a + b, 0)
  return { stakes, equalReturn: covered ? equalReturn : 0, covered, total }
}

// Grade placed variations once real results are known.
// matches: bet.matches (ordered), variations: bet.variations
// results: { [fixtureId]: { result: 'H'|'D'|'A', goals: { home, away } } }
// Only finished matches have results; a variation with any ungraded leg is 'pending'.
export function gradeVariations(matches, variations, results) {
  return variations.map((v) => {
    let hit = true
    let pending = false
    v.picks.forEach((p, i) => {
      const r = results?.[matches[i]?.fixtureId]
      if (!r?.result) { pending = true; hit = false; return }
      const totalGoals = (r.goals?.home ?? 0) + (r.goals?.away ?? 0)
      if (!pickCovers(p, r.result, totalGoals)) hit = false
    })
    return { ...v, hit: hit && !pending, pending }
  })
}

// Does a pick cover the real result? e.g. DC_H covers H and D.
export function pickCovers(pick, result, totalGoals) {
  if (!pick || !result) return false
  if (pick.k === 'H') return result === 'H'
  if (pick.k === 'D') return result === 'D'
  if (pick.k === 'A') return result === 'A'
  if (pick.k === 'DC_H') return result === 'H' || result === 'D'
  if (pick.k === 'DC_HA') return result === 'H' || result === 'A'
  if (pick.k === 'DC_D') return result === 'D' || result === 'A'
  if (pick.k === 'OV') return totalGoals != null && totalGoals > (pick.line ?? 2.5)
  if (pick.k === 'UN') return totalGoals != null && totalGoals < (pick.line ?? 2.5)
  return false
}

// ------------------------------------------------------------- Legacy combo analysis
// (kept for the old "possibilities" table)

export function analyze(matches, pickPerMatch, pickAll, minCorrect) {
  const n = matches.length
  const total = Math.pow(3, n)

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
    chance: totalProb,
    best,
    cheapest,
    safest,
    combos: passing.slice().sort((a, b) => b.prob - a.prob),
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

// ------------------------------------------------------------- Glossary

// Explains bookmaker jargon. Keys are matched against the advice string via
// TERM_PATTERNS below.
export const GLOSSARY = {
  '-3.5 goals': 'A "goals line" bet. The favourite must win by 4 or more goals for this to pay (e.g. 4-0, 5-1). "-3.5" means 3.5 goals are subtracted from their score — a 3-goal win is not enough.',
  '+3.5 goals': 'A "goals line" bet for the underdog. It pays if that team loses by 3 goals or fewer, draws, or wins (e.g. 0-3 counts as a win for this bet).',
  'double chance': 'One bet that covers two of the three possible results: 1X (home win or draw), 12 (either team wins, no draw) or X2 (draw or away win). Lower risk, lower odds.',
  'combo double chance': 'A combination where one leg (or more) is a double-chance pick instead of a plain win pick — it covers two results in that match.',
  'over 2.5': 'The match must finish with 3 or more total goals (from either team) for this leg to win.',
  'under 2.5': 'The match must finish with 2 or fewer total goals for this leg to win.',
  'over 3.5': 'The match must finish with 4 or more total goals for this leg to win.',
  'under 3.5': 'The match must finish with 3 or fewer total goals for this leg to win.',
  'asian handicap': 'A head start (in goals) given to one team before kick-off to level the odds. The line is subtracted from one team\'s final score before the bet is settled.',
  'handicap': 'A head start (in goals) given to one team before kick-off to level the odds.',
  'both teams to score': 'Also "BTTS". Wins if both teams score at least one goal in the match.',
  '1x2': 'The standard three-way market: 1 = home win, X = draw, 2 = away win.',
  'w1': 'Shorthand for "1" in 1X2 — the home team wins in regular time.',
  'w2': 'Shorthand for "2" in 1X2 — the away team wins in regular time.',
}

// Find which glossary terms appear in a piece of advice text.
export function glossaryHits(text) {
  if (!text) return []
  const t = text.toLowerCase()
  const hits = []
  for (const term of Object.keys(GLOSSARY)) {
    if (term === 'w1' || term === 'w2' || term === '1x2') {
      if (new RegExp(`\\b${term}\\b`, 'i').test(t)) hits.push(term)
    } else if (t.includes(term)) {
      hits.push(term)
    }
  }
  // Also catch "over 1.5/2.5/3.5..." and "under ..." written with digits
  const overUnder = t.match(/\b(over|under)\s+(\d(?:\.\d)?)\b/g)
  if (overUnder) {
    for (const m of overUnder) {
      const kind = m.split(' ')[0]
      const n = m.split(' ')[1]
      const key = `${kind} ${n}`
      if (!GLOSSARY[key]) {
        GLOSSARY[key] = kind === 'over'
          ? `The match must finish with more than ${n} total goals (at least ${Math.floor(parseFloat(n)) + 1}) for this leg to win.`
          : `The match must finish with ${Math.floor(parseFloat(n))} or fewer total goals for this leg to win.`
      }
      hits.push(key)
    }
  }
  return hits
}
