import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../lib/api'
import { gradeVariations, pickShort } from '../lib/bet'
import { loadHistory, deleteBet, gradeBet } from '../lib/store'
import ErrorBox from '../components/ErrorBox'

const fmtDay = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })
const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// Fetch the final result of one fixture. Returns { result, goals } or null.
async function fetchResult(fixtureId) {
  const res = await apiGet(`fixtures?id=${fixtureId}`)
  const f = res.response?.[0]
  if (!f) return null
  const s = f.status?.short
  const finished = ['FT', 'AET', 'PEN'].includes(s)
  const live = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE'].includes(s)
  const home = f.goals?.home
  const away = f.goals?.away
  if (home == null || away == null) return null
  if (!finished && !live) return null
  return {
    result: home > away ? 'H' : home < away ? 'A' : 'D',
    goals: { home, away },
    finished,
    live,
  }
}

function BetCard({ bet, onRefresh, onDelete }) {
  const [grading, setGrading] = useState(false)
  const [note, setNote] = useState(null)

  const results = bet.results || {}
  const graded = gradeVariations(bet.matches, bet.variations, results)
  const hits = graded.filter((v) => v.hit)
  const pending = graded.some((v) => v.pending)
  const staked = bet.variations.reduce((s, v) => s + (v.stake || 0), 0)
  const returned = bet.variations.reduce((s, v, i) => s + (graded[i]?.hit ? v.stake * v.combinedOdds : 0), 0)

  // Grade now: fetch results for matches that don't have one stored yet.
  const refresh = async () => {
    setGrading(true)
    setNote(null)
    try {
      const next = { ...results }
      let fetched = 0
      for (const m of bet.matches) {
        if (next[m.fixtureId]?.result) continue
        const r = await fetchResult(m.fixtureId)
        if (r) { next[m.fixtureId] = r; fetched++ }
      }
      gradeBet(bet.id, next)
      if (fetched === 0) setNote('No new results yet — matches may not have finished.')
      onRefresh()
    } catch (e) {
      setNote(e.message)
    } finally {
      setGrading(false)
    }
  }

  const status = pending && !hits.length
    ? { label: 'Pending', cls: 'text-slate-400 border-line' }
    : hits.length > 0
      ? { label: 'Won', cls: 'text-grass border-grass/40 bg-grass/10' }
      : { label: 'Lost', cls: 'text-live border-live/40 bg-live/10' }

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${status.cls}`}>
          {status.label}
        </span>
        <span className="text-sm font-semibold">
          {bet.matches.length}-match multi · {bet.variations.length} variations
        </span>
        <span className="ml-auto text-xs text-slate-400">
          {fmtDay(bet.placedAt)} {fmtTime(bet.placedAt)}
        </span>
      </div>

      {/* Matches */}
      <div className="space-y-1">
        {bet.matches.map((m, i) => {
          const r = results[m.fixtureId]
          return (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-4 text-xs text-slate-500">{i + 1}.</span>
              <Link to={`/match/${m.fixtureId}`} className="flex-1 truncate hover:text-grass">
                {m.label}
              </Link>
              {r?.result ? (
                <span className="text-xs">
                  <b className="text-grass">{r.goals.home}-{r.goals.away}</b>{' '}
                  <span className="text-slate-400">({{ H: 'W1', D: 'X', A: 'W2' }[r.result]})</span>
                </span>
              ) : (
                <span className="text-xs text-slate-500">—</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Variations */}
      <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
        {bet.variations.map((v, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
            <span className={`h-2 w-2 shrink-0 rounded-full ${graded[i]?.hit ? 'bg-grass' : graded[i]?.pending ? 'bg-slate-500' : 'bg-live'}`} />
            <span className="flex-1 space-x-1.5">
              {v.picks.map((p, j) => (
                <span key={j} className="inline-flex items-center gap-1 text-xs">
                  <b className="text-grass">{pickShort(p)}</b>
                  <span className="text-slate-400">{bet.matches[j]?.label}</span>
                </span>
              ))}
            </span>
            <span className="text-xs text-gold">@{v.combinedOdds.toFixed(2)}</span>
            <span className="w-16 text-right text-xs font-bold text-gold">stake {v.stake?.toFixed(2)}</span>
            <span className={`w-20 text-right text-xs font-bold ${graded[i]?.hit ? 'text-grass' : 'text-slate-500'}`}>
              {graded[i]?.hit ? `→ ${(v.stake * v.combinedOdds).toFixed(2)}` : '→ 0.00'}
            </span>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-lg border border-line p-2">
          <div className="text-xs text-slate-400">Staked</div>
          <div className="font-bold text-gold">{staked.toFixed(2)}</div>
        </div>
        <div className="rounded-lg border border-line p-2">
          <div className="text-xs text-slate-400">Returned</div>
          <div className={`font-bold ${returned > 0 ? 'text-grass' : 'text-slate-400'}`}>
            {returned.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg border border-line p-2">
          <div className="text-xs text-slate-400">P/L</div>
          <div className={`font-bold ${returned - staked >= 0 ? 'text-grass' : 'text-live'}`}>
            {returned - staked >= 0 ? '+' : ''}{(returned - staked).toFixed(2)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={refresh}
          disabled={grading}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold transition hover:border-grass/50 disabled:opacity-50"
        >
          {grading ? 'Checking results…' : pending ? 'Check results' : 'Re-check results'}
        </button>
        {note && <span className="text-xs text-slate-400">{note}</span>}
        <button
          onClick={() => onDelete(bet.id)}
          className="ml-auto text-xs text-slate-500 underline hover:text-live"
        >
          delete
        </button>
      </div>
    </section>
  )
}

export default function HistoryPage() {
  const [history, setHistory] = useState(() => loadHistory())

  useEffect(() => {
    const update = () => setHistory(loadHistory())
    window.addEventListener('gp:store', update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener('gp:store', update)
      window.removeEventListener('storage', update)
    }
  }, [])

  const onRefresh = () => setHistory(loadHistory())
  const onDelete = (id) => {
    if (window.confirm('Delete this bet from history?')) {
      deleteBet(id)
      setHistory(loadHistory())
    }
  }

  const totals = useMemo(() => {
    let staked = 0, returned = 0
    for (const bet of history) {
      if (!bet.results) continue
      const graded = gradeVariations(bet.matches, bet.variations, bet.results)
      for (const v of graded) {
        staked += v.stake || 0
        if (v.hit) returned += (v.stake || 0) * v.combinedOdds
      }
    }
    return { staked, returned, pl: returned - staked }
  }, [history])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Bet history</h1>
        <p className="text-sm text-slate-400">
          Multi-bets you placed in the Bet Builder. Results are graded against real fixtures —
          press "Check results" after the matches finish.
        </p>
      </div>

      {history.length > 0 && (
        <section className="card grid grid-cols-3 gap-2 p-4 text-center text-sm">
          <div>
            <div className="text-xs text-slate-400">Total staked (graded bets)</div>
            <div className="text-lg font-bold text-gold">{totals.staked.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Total returned</div>
            <div className={`text-lg font-bold ${totals.returned > 0 ? 'text-grass' : 'text-slate-400'}`}>
              {totals.returned.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Profit / loss</div>
            <div className={`text-lg font-bold ${totals.pl >= 0 ? 'text-grass' : 'text-live'}`}>
              {totals.pl >= 0 ? '+' : ''}{totals.pl.toFixed(2)}
            </div>
          </div>
        </section>
      )}

      {history.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-400">
          No bets yet. Build a multi in the{' '}
          <Link to="/builder" className="underline text-grass">Bet Builder</Link>{' '}
          and place it — it will show up here with live result grading.
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((bet) => (
            <BetCard key={bet.id} bet={bet} onRefresh={onRefresh} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
