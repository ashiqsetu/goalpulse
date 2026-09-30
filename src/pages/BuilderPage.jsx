import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, isLive, isFinished, TZ, todayLocal } from '../lib/api'
import {
  winPercentages, favoriteOutcome, bestOdds, totalsOdds,
  pickOptionsFor, pickShort, pickText, pickOdds, pickProb,
  buildVariations, splitStake,
} from '../lib/bet'
import { loadSlip, removeFromSlip, clearSlip, placeBet } from '../lib/store'
import { LEAGUE_ORDER, isWantedLeague } from '../lib/leagues'
import ErrorBox from '../components/ErrorBox'
import Info from '../components/Info'

function shiftDate(iso, days) {
  const d = new Date(iso + 'T12:00:00')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// A match can be picked while it hasn't kicked off yet (or is simply TBD).
const pickable = (f) => !isLive(f) && !isFinished(f)

export default function BuilderPage() {
  const [date, setDate] = useState(todayLocal)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(() => loadSlip()) // fixtures for the builder
  const [picks, setPicks] = useState({}) // fixtureId -> { k, line } | null
  const [mode, setMode] = useState('cover') // 'cover' = all possibilities | 'picks' = my picks only
  const [budget, setBudget] = useState(100)
  const [detail, setDetail] = useState({}) // fixtureId -> { wp, bo, totals, favorite, options }

  useEffect(() => {
    let alive = true
    setError(null)
    setData(null)
    apiGet(`fixtures?date=${date}&tz=${encodeURIComponent(TZ)}`)
      .then((res) => { if (alive) setData(res) })
      .catch((e) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [date])

  // Load odds+prediction data for selected fixtures (one by one; cached server-side)
  useEffect(() => {
    let alive = true
    const run = async () => {
      const next = {}
      for (const f of selected) {
        const id = f.fixture.id
        if (detail[id]) { next[id] = detail[id]; continue }
        const fallback = {
          wp: { H: 0.34, D: 0.33, A: 0.33 },
          bo: {}, totals: null, favorite: null, options: [],
        }
        try {
          const [pRes, oRes] = await Promise.all([
            apiGet(`predictions?fixture=${id}`).catch(() => null),
            apiGet(`odds?fixture=${id}`).catch(() => null),
          ])
          if (!alive) return
          const wp = winPercentages(pRes?.response?.[0], oRes?.response?.[0]?.bookmakers)
          const bo = bestOdds(oRes?.response?.[0]?.bookmakers || [])
          const hasWp = wp.H || wp.D || wp.A
          const safeWp = hasWp ? wp : fallback.wp
          const totals = totalsOdds(safeWp, bo)
          const favorite = favoriteOutcome(safeWp)
          next[id] = { wp: safeWp, bo, totals, favorite, options: pickOptionsFor(safeWp, totals, favorite) }
        } catch {
          if (!alive) return
          next[id] = { ...fallback, favorite: 'H', options: pickOptionsFor(fallback.wp, null, 'H') }
        }
      }
      if (alive) setDetail((d) => ({ ...d, ...next }))
    }
    if (selected.length) run()
    return () => { alive = false }
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const fixtures = useMemo(() => {
    const list = (data?.response || []).filter((f) => pickable(f) && isWantedLeague(f.league.id))
    return list.sort((a, b) => {
      const ia = LEAGUE_ORDER.indexOf(a.league.id); const ib = LEAGUE_ORDER.indexOf(b.league.id)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.timestamp - b.timestamp
    })
  }, [data])

  const builderMatches = useMemo(
    () => selected.map((f) => {
      const id = f.fixture.id
      const d = detail[id] || { wp: { H: 0.34, D: 0.33, A: 0.33 }, bo: {}, totals: null, favorite: null, options: [] }
      return {
        id,
        fixtureIds: [id],
        label: `${f.teams.home.name} vs ${f.teams.away.name}`,
        home: f.teams.home,
        away: f.teams.away,
        kickoff: f.date,
        wp: d.wp,
        odds: d.bo,
        totals: d.totals,
        favorite: d.favorite,
        options: d.options,
      }
    }),
    [selected, detail],
  )

  // Resolve the pick options per match according to mode:
  //  - 'picks': exactly the user's pick (system favourite where unpicked) → 1 variation
  //  - 'cover': every available option per match → all variations, one always wins
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const optionsPerMatch = useMemo(() => builderMatches.map((m) => {
    const base = m.options?.length ? m.options : [{ k: 'H' }, { k: 'D' }, { k: 'A' }]
    if (mode === 'picks') {
      const chosen = picks[m.id]
      return chosen ? [chosen] : [base[0]]
    }
    return base
  }), [builderMatches, picks, mode])

  const variationsResult = useMemo(() => {
    if (builderMatches.length === 0) return null
    // "All possibilities" enumerates options^N combinations. Guard the
    // explosion: past a threshold, enumerate the core 1X2 outcomes only.
    const projected = optionsPerMatch.reduce((a, o) => a * Math.max(1, o.length), 1)
    const capped = projected > 3000
    const perMatch = capped
      ? optionsPerMatch.map((o) => {
          const core = o.filter((x) => x.k === 'H' || x.k === 'D' || x.k === 'A')
          return core.length ? core : o.slice(0, 3)
        })
      : optionsPerMatch
    const { variations } = buildVariations(builderMatches, perMatch)
    const withOdds = variations.filter((v) => v.combinedOdds > 1)
    const split = splitStake(withOdds, budget)
    return { variations: withOdds, split, mode, capped }
  }, [builderMatches, optionsPerMatch, budget])

  const toggle = (f) => {
    setSelected((sel) => sel.some((s) => s.fixture.id === f.fixture.id)
      ? sel.filter((s) => s.fixture.id !== f.fixture.id)
      : [...sel, f])
    setPicks((p) => {
      const next = { ...p }
      delete next[f.fixture.id]
      return next
    })
  }

  const place = () => {
    if (!variationsResult || variationsResult.variations.length === 0) return
    placeBet({
      matches: builderMatches.map((m) => ({
        fixtureId: m.id, label: m.label, kickoff: m.kickoff,
      })),
      variations: variationsResult.variations.map((v, i) => ({
        picks: v.picks.map((p) => ({ k: p.k, line: p.line ?? null })),
        legOdds: v.legOdds,
        combinedOdds: v.combinedOdds,
        stake: variationsResult.split.stakes[i] || 0,
      })),
      budget: variationsResult.split.total,
    })
    clearSlip()
    setSelected([])
    setPicks({})
  }

  const placed = variationsResult?.split?.total ?? 0
  const minReturn = variationsResult?.split?.equalReturn ?? 0

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Bet Builder</h1>
        <p className="text-sm text-slate-400">
          Add matches, generate every variation, split your budget so any winning
          variation pays back everything.
        </p>
      </div>

      {/* Step 1: choose matches */}
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-semibold">1 · Choose matches</h3>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => setDate(shiftDate(date, -1))} className="rounded px-2 py-1 hover:bg-white/5">◀</button>
            <span className="font-mono">{date}</span>
            <button onClick={() => setDate(shiftDate(date, 1))} className="rounded px-2 py-1 hover:bg-white/5">▶</button>
          </div>
        </div>
        {error && <ErrorBox message={error} />}
        {!data ? (
          <div className="h-32 animate-pulse rounded-lg bg-white/5" />
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {fixtures.map((f) => {
              const on = selected.some((s) => s.fixture.id === f.fixture.id)
              return (
                <button
                  key={f.fixture.id}
                  onClick={() => toggle(f)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                    on ? 'border-grass bg-grass/10' : 'border-line hover:border-grass/50'
                  }`}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? 'border-grass bg-grass text-pitch' : 'border-slate-500'}`}>
                    {on && '✓'}
                  </span>
                  <img src={f.league.logo} alt="" className="h-4 w-4 opacity-70" />
                  <span className="flex-1 truncate">
                    {f.teams.home.name} <span className="text-slate-500">vs</span> {f.teams.away.name}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(f.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              )
            })}
            {fixtures.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-400">
                No upcoming matches on this date. Use ◀ ▶ to browse other days.
              </div>
            )}
          </div>
        )}
        {selected.length > 0 && (
          <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
            <span>{selected.length} match(es) selected</span>
            <button
              onClick={() => { clearSlip(); setSelected([]); setPicks({}) }}
              className="underline hover:text-live"
            >
              Clear all
            </button>
          </div>
        )}
      </section>

      {/* Step 2: picks per match */}
      {selected.length > 0 && (
        <section className="card p-4">
          <h3 className="mb-1 font-semibold">2 · Your picks</h3>
          <p className="mb-3 text-xs text-slate-400">
            Optionally pick an outcome per match. Anything you leave unpicked gets
            <b> every variation</b> generated in "cover" mode. <Info>Double chance covers two of the three results — lower odds, but much safer.</Info>
          </p>
          <div className="space-y-2">
            {selected.map((f) => {
              const id = f.fixture.id
              const d = detail[id]
              const fav = d?.favorite
              const opts = d?.options?.length ? d.options : [{ k: 'H' }, { k: 'D' }, { k: 'A' }]
              return (
                <div key={id} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <img src={f.teams.home.logo} alt="" className="h-4 w-4" />
                    <span className="font-medium">{f.teams.home.name}</span>
                    <span className="text-slate-500">vs</span>
                    <span className="font-medium">{f.teams.away.name}</span>
                    <img src={f.teams.away.logo} alt="" className="h-4 w-4" />
                    {d && (
                      <span className="ml-auto text-xs text-grass">
                        System: {pickShort({ k: fav })} {Math.round(d.wp[fav] * 100)}%
                      </span>
                    )}
                    <button
                      onClick={() => removeFromSlip(id)}
                      className="text-xs text-slate-500 underline hover:text-live"
                    >
                      remove
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {opts.map((opt) => {
                      const odd = pickOdds(opt, d?.bo, d?.totals)
                      const on = picks[id]?.k === opt.k && (opt.line == null || picks[id]?.line === opt.line)
                      const prob = d ? pickProb(opt, d.wp, d.totals) : 0
                      return (
                        <button
                          key={opt.k + (opt.line ?? '')}
                          onClick={() => setPicks((p) => ({ ...p, [id]: on ? null : opt }))}
                          className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition ${
                            on ? 'border-grass bg-grass text-pitch font-bold' : 'border-line hover:border-grass/50'
                          }`}
                          title={pickText(opt, f.teams.home.name, f.teams.away.name)}
                        >
                          {pickShort(opt)}
                          {odd && <span className="ml-1 opacity-70">@{odd}</span>}
                          {prob > 0 && <span className="ml-1 hidden opacity-60 sm:inline">{Math.round(prob * 100)}%</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === 'picks'}
                onChange={() => setMode('picks')}
              />
              Use my picks only
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === 'cover'}
                onChange={() => setMode('cover')}
              />
              All possibilities (guaranteed at least one wins)
            </label>
          </div>
        </section>
      )}

      {/* Step 3: budget + variations */}
      {variationsResult && builderMatches.length > 0 && (
        <section className="card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold">3 · Budget & variations</h3>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Total budget</span>
              <input
                type="number"
                min={1}
                value={budget}
                onChange={(e) => setBudget(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-24 rounded-lg border border-line bg-pitch px-2 py-1 text-right font-bold text-gold"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-gold/40 bg-gold/10 p-3">
              <div className="text-xs text-slate-300">Total staked</div>
              <div className="text-2xl font-black text-gold">{placed.toFixed(2)}</div>
            </div>
            <div className="rounded-lg border border-grass/40 bg-grass/10 p-3">
              <div className="text-xs text-slate-300">If the best variation wins</div>
              <div className="text-2xl font-black text-grass">
                {variationsResult.split.stakes.length
                  ? Math.max(...variationsResult.variations.map((v, i) => (variationsResult.split.stakes[i] || 0) * v.combinedOdds)).toFixed(2)
                  : '0.00'}
              </div>
            </div>
            <div className="rounded-lg border border-line p-3">
              <div className="text-xs text-slate-400">If the worst variation wins</div>
              <div className="text-xl font-bold">
                {variationsResult.split.stakes.length
                  ? Math.min(...variationsResult.variations.map((v, i) => (variationsResult.split.stakes[i] || 0) * v.combinedOdds)).toFixed(2)
                  : '0.00'}
              </div>
            </div>
            <div className={`rounded-lg border p-3 ${variationsResult.split.covered ? 'border-grass/40 bg-grass/10' : 'border-line'}`}>
              <div className="text-xs text-slate-300">
                Guaranteed minimum{' '}
                <Info term="guaranteed minimum">
                  With "cover everything" mode, one variation always matches the real results, so this
                  is the least you get back. In "use my picks" mode it only applies if one of your
                  picked variations wins.
                </Info>
              </div>
              <div className={`text-2xl font-black ${variationsResult.split.covered ? 'text-grass' : 'text-slate-400'}`}>
                {minReturn.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-400">
                {variationsResult.split.covered
                  ? (minReturn >= budget ? 'covers your full budget ✓' : 'slightly under budget (rounding)')
                  : 'add more picks / use cover mode'}
              </div>
            </div>
          </div>

          {/* Variations list */}
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">
                {variationsResult.variations.length} variation{variationsResult.variations.length === 1 ? '' : 's'}
                {mode === 'cover' && ' — one of them is guaranteed to match the real results'}
                {variationsResult.capped && ' · core outcomes only (remove a match for full coverage)'}
              </div>
            </div>
            <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {variationsResult.variations
                .map((v, i) => ({ v, i }))
                .sort((a, b) => b.v.prob - a.v.prob)
                .slice(0, 200)
                .map(({ v, i }, rank) => (
                  <div key={i} className="rounded-lg border border-line px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-6 text-xs text-slate-500">#{rank + 1}</span>
                      <span className="flex-1 space-x-1">
                        {v.picks.map((p, j) => (
                          <span key={j} className="inline-flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-xs">
                            <span className="text-slate-400">{j + 1}.</span>
                            <b className="text-grass">{pickShort(p)}</b>
                            <span className="text-slate-400">{builderMatches[j].home.name} vs {builderMatches[j].away.name}</span>
                          </span>
                        ))}
                      </span>
                      <span className="text-xs text-gold">@{v.combinedOdds.toFixed(2)}</span>
                      <span className="w-16 text-right text-xs text-slate-400">{(v.prob * 100).toFixed(1)}%</span>
                      <span className="w-20 text-right text-xs font-bold text-gold">
                        stake {(variationsResult.split.stakes[i] || 0).toFixed(2)}
                      </span>
                      <span className="w-20 text-right text-xs text-grass">
                        → {(variationsResult.split.stakes[i] * v.combinedOdds || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
            {variationsResult.variations.length > 200 && (
              <div className="mt-2 text-center text-xs text-slate-500">
                Showing the 200 most likely of {variationsResult.variations.length} variations —
                the stake is already split across all of them.
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={place}
              disabled={placed <= 0}
              className="rounded-lg bg-grass px-6 py-2 font-bold text-pitch transition hover:opacity-90 disabled:opacity-40"
            >
              Place multi-bet ({placed.toFixed(2)})
            </button>
            <Link to="/history" className="text-sm text-slate-400 underline hover:text-grass">
              view your bet history →
            </Link>
          </div>

          <div className="mt-3 text-xs text-slate-500">
            Odds combine per-leg; double-chance and over/under prices are derived from the 1X2
            market. Probabilities are statistical estimates from predictions + odds — not a
            guarantee. Bet responsibly.
          </div>
        </section>
      )}

      {selected.length === 0 && (
        <div className="card p-6 text-center text-sm text-slate-400">
          Select matches above (or tap "+ Add to Bet Builder" on any match page) to generate
          every variation, split your budget across them, and guarantee yourself at least one
          winning ticket.
        </div>
      )}
    </div>
  )
}
