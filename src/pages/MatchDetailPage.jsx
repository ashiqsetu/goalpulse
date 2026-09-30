import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { apiGet, planError, fmtTime, fmtStatus, isLive, isFinished } from '../lib/api'
import { winPercentages, favoriteOutcome, bestOdds, h2hDistribution, accOdds, OUTCOME_LABEL, glossaryHits } from '../lib/bet'
import { addToSlip, loadSlip } from '../lib/store'
import ErrorBox from '../components/ErrorBox'
import Info from '../components/Info'

// System suggestion with hover notes for betting jargon ("-3.5 goals" etc.)
function Suggestion({ text }) {
  const hits = glossaryHits(text)
  return (
    <div className="mt-3 rounded-lg border border-grass/40 bg-grass/10 p-3 text-sm">
      <span className="font-semibold text-grass">System suggestion:</span>{' '}
      {text}
      {hits.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-grass/20 pt-2">
          <span className="text-[11px] text-slate-400">What this means — hover:</span>
          {hits.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-pitch-2 px-2 py-0.5 text-[11px] text-slate-200">
              {t} <Info term={t} />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ProbBar({ wp, pick, onPick }) {
  const rows = [
    ['H', 'Home', wp.H],
    ['D', 'Draw', wp.D],
    ['A', 'Away', wp.A],
  ]
  return (
    <div className="space-y-2">
      {rows.map(([k, label, p]) => (
        <button
          key={k}
          onClick={() => onPick?.(k)}
          className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
            pick === k ? 'border-grass bg-grass/10' : 'border-line hover:border-grass/50'
          }`}
        >
          <span className="w-14 text-xs font-semibold text-slate-300">{label}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${pick === k ? 'bg-grass' : 'bg-grass/50'}`}
              style={{ width: `${Math.round((p || 0) * 100)}%` }}
            />
          </div>
          <span className="w-12 text-right text-sm font-bold tabular-nums">
            {Math.round((p || 0) * 100)}%
          </span>
          {pick === k && <span className="text-grass">✓</span>}
        </button>
      ))}
    </div>
  )
}

function VoteBox({ fixtureId, homeName, awayName }) {
  const [votes, setVotes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('gp_votes') || '{}')
    } catch { return {} }
  })
  const [tally, setTally] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('gp_tally') || '{}')
    } catch { return {} }
  })

  const myVote = votes[fixtureId]
  const t = tally[fixtureId] || { H: 0, D: 0, A: 0 }
  const total = t.H + t.D + t.A

  const vote = (k) => {
    const nv = { ...votes, [fixtureId]: k }
    const nt = { ...tally }
    if (!nt[fixtureId]) nt[fixtureId] = { H: 0, D: 0, A: 0 }
    // move vote if changed
    if (myVote) nt[fixtureId][myVote]--
    nt[fixtureId][k]++
    setVotes(nv)
    setTally(nt)
    localStorage.setItem('gp_votes', JSON.stringify(nv))
    localStorage.setItem('gp_tally', JSON.stringify(nt))
  }

  const names = { H: homeName, D: 'Draw', A: awayName }

  return (
    <div className="card p-4">
      <h3 className="mb-3 font-semibold">Community vote {total > 0 && <span className="text-xs font-normal text-slate-400">({total} votes)</span>}</h3>
      <div className="space-y-2">
        {['H', 'D', 'A'].map((k) => {
          const pct = total ? Math.round((t[k] / total) * 100) : 0
          return (
            <button
              key={k}
              onClick={() => vote(k)}
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                myVote === k ? 'border-grass bg-grass/10' : 'border-line hover:border-grass/50'
              }`}
            >
              <span className="flex-1 truncate text-left">{names[k]}</span>
              <span className="text-xs text-slate-400">{pct}%</span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Votes are stored on your device (demo polling — connect a backend DB to aggregate all users).
      </p>
    </div>
  )
}

function Form({ team }) {
  const form = team?.last_5?.form || ''
  if (!form) return null
  return (
    <div className="flex items-center gap-1">
      {form.split('').map((c, i) => (
        <span
          key={i}
          title={c === 'W' ? 'Win' : c === 'L' ? 'Loss' : 'Draw'}
          className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${
            c === 'W' ? 'bg-grass/20 text-grass' : c === 'L' ? 'bg-live/20 text-live' : 'bg-white/10 text-slate-300'
          }`}
        >
          {c}
        </span>
      ))}
    </div>
  )
}

export default function MatchDetailPage() {
  const { fixtureId } = useParams()
  const navigate = useNavigate()
  const [fx, setFx] = useState(null)
  const [pred, setPred] = useState(null)
  const [odds, setOdds] = useState(null)
  const [h2h, setH2h] = useState(null)
  const [standings, setStandings] = useState(null)
  const [error, setError] = useState(null)
  const [pick, setPick] = useState(null)
  const [slipCount, setSlipCount] = useState(() => loadSlip().length)

  useEffect(() => {
    let alive = true
    setError(null)
    setFx(null); setPred(null); setOdds(null); setH2h(null); setStandings(null)

    const run = async () => {
      try {
        const fRes = await apiGet(`fixtures?id=${fixtureId}`)
        if (!alive) return
        const fixture = fRes.response?.[0]
        setFx(fixture)
        if (!fixture) return

        const [pRes, oRes, hRes] = await Promise.all([
          apiGet(`predictions?fixture=${fixtureId}`).catch(() => null),
          apiGet(`odds?fixture=${fixtureId}`).catch(() => null),
          apiGet(`fixtures/headtohead?h2h=${fixture.teams.home.id}-${fixture.teams.away.id}`).catch(() => null),
        ])
        if (!alive) return
        setPred(pRes)
        setOdds(oRes)
        setH2h(hRes)

        const sid = fixture.league.season
        const sRes = await apiGet(`standings?league=${fixture.league.id}&season=${sid}`).catch(() => null)
        if (!alive) return
        setStandings(sRes)
      } catch (e) {
        if (alive) setError(e.message)
      }
    }
    run()
    return () => { alive = false }
  }, [fixtureId])

  if (error) return <ErrorBox message={error} />
  if (!fx) return <div className="card h-40 animate-pulse opacity-50" />

  const home = fx.teams.home
  const away = fx.teams.away
  const started = isLive(fx) || isFinished(fx)
  const planErr = planError(pred)

  const wp = winPercentages(pred?.response?.[0], odds?.response?.[0]?.bookmakers)
  // Augment with h2h history when no prediction available
  if (!wp.H && !wp.D && !wp.A && h2h?.response?.length) {
    const dist = h2hDistribution(h2h.response, home.id, away.id)
    if (dist) { wp.H = dist.H; wp.D = dist.D; wp.A = dist.A }
  }
  const fav = favoriteOutcome(wp)
  const bo = bestOdds(odds?.response?.[0]?.bookmakers || [])
  const advice = pred?.response?.[0]?.predictions?.advice
  const predComment = pred?.response?.[0]?.predictions?.winner?.comment
  const comparison = pred?.response?.[0]?.comparison

  const findRow = (teamId) => {
    const rows = standings?.response?.[0]?.league?.standings?.[0] || []
    return rows.find((r) => r.team.id === teamId)
  }
  const rowH = findRow(home.id)
  const rowA = findRow(away.id)

  const acc = pick ? accOdds([pick === 'H' ? bo.H?.odd : pick === 'D' ? bo.D?.odd : bo.A?.odd]) : null
  const inSlip = loadSlip().some((e) => e.fixture?.id === fx.fixture.id)
  const addFixtureToSlip = () => {
    addToSlip(fx)
    setSlipCount(loadSlip().length)
    navigate('/builder')
  }

  return (
    <div className="space-y-4">
      {/* Scoreboard */}
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-center gap-2 text-xs text-slate-400">
          <img src={fx.league.logo} alt="" className="h-4 w-4" />
          {fx.league.name} · {fx.league.round} · {fmtTime(fx.date)}
        </div>
        <div className="grid grid-cols-3 items-center">
          <Link to={`/team/${home.id}`} className="flex flex-col items-center gap-2 hover:opacity-80">
            <img src={home.logo} alt="" className="h-12 w-12" />
            <span className="text-center text-sm font-semibold">{home.name}</span>
          </Link>
          <div className="text-center">
            {started ? (
              <div className="text-3xl font-black tabular-nums">
                {fx.goals.home} - {fx.goals.away}
              </div>
            ) : (
              <div className="text-2xl font-bold text-slate-300">vs</div>
            )}
            <div className={`mt-1 text-xs font-semibold ${isLive(fx) ? 'text-live' : 'text-slate-400'}`}>
              {isLive(fx) && <span className="live-dot mr-1" />}
              {fmtStatus(fx)}
            </div>
          </div>
          <Link to={`/team/${away.id}`} className="flex flex-col items-center gap-2 hover:opacity-80">
            <img src={away.logo} alt="" className="h-12 w-12" />
            <span className="text-center text-sm font-semibold">{away.name}</span>
          </Link>
        </div>
        <div className="mt-3 flex items-center justify-center gap-4 text-xs text-slate-400">
          <Form team={pred?.response?.[0]?.teams?.home} />
          <span>·</span>
          <Form team={pred?.response?.[0]?.teams?.away} />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Win probability + system suggestion */}
        <section className="card p-4">
          <h3 className="mb-1 font-semibold">Win probability</h3>
          <p className="mb-3 text-xs text-slate-400">
            From bookmaker odds + algorithmic prediction. Click a row to build your bet.
          </p>
          <ProbBar wp={wp} pick={pick} onPick={setPick} />
          {(advice || predComment) && <Suggestion text={advice || predComment} />}
          {!advice && !predComment && wp[fav] > 0 && (
            <div className="mt-3 rounded-lg border border-grass/40 bg-grass/10 p-3 text-sm">
              <span className="font-semibold text-grass">System suggestion:</span>{' '}
              {OUTCOME_LABEL[fav]} — {Math.round(wp[fav] * 100)}% chance
              {bo[fav]?.odd ? ` @ ${bo[fav].odd}` : ''}
            </div>
          )}
          {/* Add to bet builder */}
          {!started && (
            <button
              onClick={addFixtureToSlip}
              disabled={inSlip}
              className={`mt-3 w-full rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                inSlip
                  ? 'cursor-default border-grass/40 bg-grass/10 text-grass'
                  : 'border-grass bg-grass text-pitch hover:opacity-90'
              }`}
            >
              {inSlip ? '✓ In your bet builder' : '+ Add to Bet Builder'}
            </button>
          )
          }
          {pick && (
            <div className="mt-3 rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm text-gold">
              Your pick: <b>{OUTCOME_LABEL[pick]}</b>
              {acc && acc > 1 && <> · odds {acc.toFixed(2)}</>}
            </div>
          )}
          {slipCount > 0 && (
            <div className="mt-2 text-right text-xs text-slate-400">
              {slipCount} match{slipCount > 1 ? 'es' : ''} in your builder ·{' '}
              <Link to="/builder" className="underline hover:text-grass">open</Link>
            </div>
          )}
          {planErr && <div className="mt-3 text-xs text-slate-500">Prediction note: {planErr}</div>}
        </section>

        <VoteBox fixtureId={fx.fixture.id} homeName={home.name} awayName={away.name} />
      </div>

      {/* Comparison + standings context */}
      {(comparison || rowH || rowA) && (
        <section className="card p-4">
          <h3 className="mb-3 font-semibold">Form guide</h3>
          {comparison && (
            <div className="mb-4 space-y-2">
              {['form', 'att', 'def', 'poisson_distribution', 'h2h', 'total'].map((k) => {
                const c = comparison[k]
                if (!c) return null
                return (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-8 text-right font-semibold tabular-nums">{c.home}%</span>
                    <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-grass/70" style={{ width: `${c.home}%` }} />
                      <div className="h-full bg-sky-500/70" style={{ width: `${c.away}%` }} />
                    </div>
                    <span className="w-8 font-semibold tabular-nums">{c.away}%</span>
                    <span className="w-32 text-slate-400">{k.replace(/_/g, ' ')}</span>
                  </div>
                )
              })}
            </div>
          )}
          {(rowH || rowA) && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[rowH, rowA].map((r, i) =>
                r ? (
                  <div key={i} className="rounded-lg border border-line p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <img src={r.team.logo} alt="" className="h-4 w-4" />
                      <span className="font-semibold">{r.team.name}</span>
                      <span className="ml-auto text-xs text-slate-400">#{r.rank}</span>
                    </div>
                    <div className="text-xs text-slate-300">
                      {r.points} pts · {r.all.played} played · GD {r.goalsDiff > 0 ? '+' : ''}{r.goalsDiff}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Home {r.home.win}W-{r.home.draw}D-{r.home.lose}L · Away {r.away.win}W-{r.away.draw}D-{r.away.lose}L
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          )}
        </section>
      )}

      {/* Head to head */}
      {h2h?.response?.length > 0 && (
        <section className="card overflow-hidden">
          <header className="border-b border-line px-4 py-2 font-semibold">Head to head</header>
          <div className="divide-y divide-line/60">
            {h2h.response.slice(0, 8).map((f) => (
              <div key={f.fixture.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-20 shrink-0 text-xs text-slate-400">
                  {new Date(f.date).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })}
                </span>
                <img src={f.teams.home.logo} alt="" className="h-4 w-4" />
                <span className={`truncate ${f.teams.home.name === home.name || f.teams.away.name === home.name ? '' : ''}`}>{f.teams.home.name}</span>
                <span className="font-bold tabular-nums">{f.goals.home}-{f.goals.away}</span>
                <span className="truncate">{f.teams.away.name}</span>
                <img src={f.teams.away.logo} alt="" className="h-4 w-4" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Odds table */}
      {/* placeholder-anchor */}
      {odds?.response?.length > 0 && (
        <section className="card p-4">
          <h3 className="mb-3 font-semibold">Match winner odds</h3>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {[['Home', bo.H], ['Draw', bo.D], ['Away', bo.A]].map(([label, v]) => (
              <div key={label} className="rounded-lg border border-line p-3">
                <div className="text-xs text-slate-400">{label}</div>
                <div className="text-lg font-bold text-gold">{v?.odd ?? '—'}</div>
                <div className="text-[10px] text-slate-500">{v && Math.round((1 / parseFloat(v.odd)) * 100) + '% implied'}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-right text-xs text-slate-500">
            {odds.response[0].bookmakers?.[0]?.name === 'GoalPulse model (estimate)'
              ? 'model estimate — not bookmaker prices'
              : `best of ${odds.response[0].bookmakers?.length ?? 0} bookmakers`}
          </div>
        </section>
      )}
    </div>
  )
}
