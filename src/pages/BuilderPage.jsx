import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, planError, isLive } from '../lib/api'
import { OUTCOME_LABEL, bestOdds, winPercentages, favoriteOutcome, analyze, describePlan } from '../lib/bet'
import ErrorBox from '../components/ErrorBox'

function shiftDate(iso, days) {
  const d = new Date(iso + 'T12:00:00')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const pickable = (f) => !isLive(f) && !isFinished(f) && f.status.short === 'NS'

export default function BuilderPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState([]) // fixtures selected for the builder
  const [picks, setPicks] = useState({}) // fixtureId -> 'H' | 'D' | 'A'
  const [mode, setMode] = useState('all') // 'all' | 'min1' | 'min2'
  const [detail, setDetail] = useState({}) // fixtureId -> { wp, bo, favorite }

  useEffect(() => {
    let alive = true
    setError(null)
    setData(null)
    apiGet(`fixtures?date=${date}`)
      .then((res) => { if (alive) setData(res) })
      .catch((e) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [date])

  // Load odds+prediction data for selected fixtures (one by one; cached by the server)
  useEffect(() => {
    let alive = true
    const run = async () => {
      const next = {}
      for (const f of selected) {
        const id = f.fixture.id
        if (detail[id]) { next[id] = detail[id]; continue }
        try {
          const [pRes, oRes] = await Promise.all([
            apiGet(`predictions?fixture=${id}`).catch(() => null),
            apiGet(`odds?fixture=${id}`).catch(() => null),
          ])
          if (!alive) return
          const wp = winPercentages(pRes?.response?.[0], oRes?.response?.[0]?.bookmakers)
          const bo = bestOdds(oRes?.response?.[0]?.bookmakers || [])
          next[id] = {
            wp: wp.H || wp.D || wp.A ? wp : { H: 0.34, D: 0.33, A: 0.33 },
            bo,
            favorite: favoriteOutcome(wp),
          }
        } catch {
          if (!alive) return
          next[id] = { wp: { H: 0.34, D: 0.33, A: 0.33 }, bo: {}, favorite: 'H' }
        }
      }
      if (alive) setDetail((d) => ({ ...d, ...next }))
    }
    if (selected.length) run()
    return () => { alive = false }
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const fixtures = useMemo(() => {
    const list = (data?.response || []).filter(pickable)
    const order = [39, 140, 135, 78, 61]
    return list.sort((a, b) => {
      const ia = order.indexOf(a.league.id); const ib = order.indexOf(b.league.id)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.timestamp - b.timestamp
    })
  }, [data])

  const builderMatches = useMemo(
    () => selected.map((f) => {
      const id = f.fixture.id
      const d = detail[id] || { wp: { H: 0.34, D: 0.33, A: 0.33 }, bo: {}, favorite: null }
      return {
        id,
        label: `${f.teams.home.name} vs ${f.teams.away.name}`,
        home: f.teams.home,
        away: f.teams.away,
        wp: d.wp,
        odds: d.bo,
      }
    }),
    [selected, detail],
  )

  const pickPerMatch = builderMatches.map((m) => picks[m.id] || null)
  const result = useMemo(() => {
    if (builderMatches.length === 0) return null
    const minCorrect = mode === 'all' ? builderMatches.length : mode === 'min2' ? 2 : 1
    return analyze(builderMatches, pickPerMatch, mode === 'all', minCorrect)
  }, [builderMatches, picks, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (f) => {
    setSelected((sel) => sel.some((s) => s.fixture.id === f.fixture.id)
      ? sel.filter((s) => s.fixture.id !== f.fixture.id)
      : [...sel, f])
  }

  const bestOddsValue = (bo) => {
    const fav = favoriteOutcome(
      bo.H ? { H: 1 / parseFloat(bo.H.odd), D: bo.D ? 1 / parseFloat(bo.D.odd) : 0, A: bo.A ? 1 / parseFloat(bo.A.odd) : 0 } : { H: 0, D: 0, A: 0 },
    )
    return bo[fav]?.odd
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Bet Builder</h1>
        <p className="text-sm text-slate-400">
          Pick matches and outcomes — GoalPulse maps every combination and shows the chance
          that at least one of your predictions wins.
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
                No upcoming matches on this date (only not-started matches can be picked).
              </div>
            )}
          </div>
        )}
        {selected.length > 0 && (
          <div className="mt-2 text-xs text-slate-400">{selected.length} match(es) selected</div>
        )}
      </section>

      {/* Step 2: picks per match */}
      {selected.length > 0 && (
        <section className="card p-4">
          <h3 className="mb-3 font-semibold">2 · Your picks (optional — leave a match open to explore all outcomes)</h3>
          <div className="space-y-2">
            {selected.map((f) => {
              const id = f.fixture.id
              const d = detail[id]
              const fav = d?.favorite
              return (
                <div key={id} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    <img src={f.teams.home.logo} alt="" className="h-4 w-4" />
                    <span className="font-medium">{f.teams.home.name}</span>
                    <span className="text-slate-500">vs</span>
                    <span className="font-medium">{f.teams.away.name}</span>
                    <img src={f.teams.away.logo} alt="" className="h-4 w-4" />
                    {d && (
                      <span className="ml-auto text-xs text-grass">
                        System: {OUTCOME_LABEL[fav]} {Math.round(d.wp[fav] * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {['H', 'D', 'A'].map((k) => (
                      <button
                        key={k}
                        onClick={() => setPicks((p) => ({ ...p, [id]: p[id] === k ? undefined : k }))}
                        className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition ${
                          picks[id] === k ? 'border-grass bg-grass text-pitch font-bold' : 'border-line hover:border-grass/50'
                        }`}
                      >
                        {k === 'H' ? f.teams.home.name : k === 'A' ? f.teams.away.name : 'Draw'}
                        {d?.bo[k]?.odd && <span className="ml-1 opacity-70">@{d.bo[k].odd}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Step 3: analysis */}
      {result && builderMatches.length > 0 && (
        <section className="card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">3 · Possibilities & ways to win</h3>
            <div className="flex rounded-lg border border-line p-0.5 text-xs">
              {[['all', 'All must win'], ['min2', 'At least 2'], ['min1', 'At least 1']].map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setMode(v)}
                  className={`rounded-md px-3 py-1 font-semibold transition ${
                    mode === v ? 'bg-grass text-pitch' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-grass/40 bg-grass/10 p-3">
              <div className="text-xs text-slate-300">Chance at least one combo wins</div>
              <div className="text-2xl font-black text-grass">{Math.round(result.chance * 100)}%</div>
              <div className="text-xs text-slate-400">
                {result.passingCount} of {result.totalCombos} combinations qualify
              </div>
            </div>
            <div className="rounded-lg border border-line p-3">
              <div className="text-xs text-slate-400">Safest combo</div>
              <div className="mt-1 text-sm font-semibold">{result.safest ? describePlan(builderMatches, result.safest.picks) : '—'}</div>
              {result.safest && <div className="mt-1 text-xs text-grass">{(result.safest.prob * 100).toFixed(1)}% likely</div>}
            </div>
            <div className="rounded-lg border border-line p-3">
              <div className="text-xs text-slate-400">Best-paying combo</div>
              <div className="mt-1 text-sm font-semibold">{result.best && result.best.odds > 0 ? describePlan(builderMatches, result.best.picks) : '—'}</div>
              {result.best && result.best.odds > 0 && <div className="mt-1 text-xs text-gold">@ {result.best.odds.toFixed(2)} combined</div>}
            </div>
          </div>

          {/* All qualifying combinations */}
          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold">All winning paths (top 12 by likelihood)</div>
            <div className="space-y-1.5">
              {result.combos.slice(0, 12).map((c, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <span className="w-6 text-xs text-slate-500">#{i + 1}</span>
                  <span className="flex-1">{describePlan(builderMatches, c.picks)}</span>
                  <span className="text-xs text-slate-400">{(c.prob * 100).toFixed(1)}%</span>
                  {c.odds > 0 && <span className="text-xs text-gold">@{c.odds.toFixed(2)}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Cover advice */}
          <div className="mt-4 rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm text-gold">
            <b>Strategy:</b>{' '}
            {mode === 'all' ? (
              <>Every pick must land for a win — highest chance path: <b>{result.safest ? describePlan(builderMatches, result.safest.picks) : '—'}</b> ({(result.safest?.prob * 100 || 0).toFixed(1)}%). Cover more paths by switching to "At least 1".</>
            ) : (
              <>
                You win if any qualifying combo lands. Covering all {result.passingCount} paths costs ~
                {' '}{(result.cheapest && result.cheapest.odds > 0 ? result.cheapest.odds : 0).toFixed(2)}× your stake per winning path at minimum —
                combine opposite outcomes on the same match (e.g. team win + draw) to guarantee at least one hit.
              </>
            )}
          </div>

          <div className="mt-3 text-xs text-slate-500">
            Probabilities combine per-match win % (prediction + odds). This is statistical guidance, not a guarantee. Bet responsibly.
          </div>
        </section>
      )}

      {selected.length === 0 && (
        <div className="card p-6 text-center text-sm text-slate-400">
          Select 1–4 matches above to see every possible outcome combination, the system's
          suggested picks, and how to cover variations so at least one prediction wins.
        </div>
      )}
    </div>
  )
}
