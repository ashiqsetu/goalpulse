import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiGet, fmtTime, fmtStatus, isLive, isFinished } from '../lib/api'
import MatchRow from '../components/MatchRow'
import ErrorBox from '../components/ErrorBox'

export default function TeamPage() {
  const { teamId } = useParams()
  const [team, setTeam] = useState(null)
  const [teamRes, setTeamRes] = useState(null)
  const [fixtures, setFixtures] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setError(null)
    setTeam(null)
    setFixtures(null)
    // Team profile and schedule are separate endpoints; run them in parallel —
    // the schedule call also backfills the server's fixture-id index.
    apiGet(`teams?id=${teamId}`)
      .then((res) => { if (alive) setTeam(res.response?.[0] || null) })
      .catch((e) => { if (alive) setError(e.message) })
    apiGet(`fixtures?team=${teamId}`)
      .then((res) => { if (alive) setFixtures(res) })
      .catch(() => { /* schedule is optional */ })
    return () => { alive = false }
  }, [teamId])

  const list = fixtures?.response || []
  const now = Date.now() / 1000
  const upcoming = useMemo(
    () => list.filter((f) => f.status.short === 'NS' && f.timestamp >= now).slice(0, 8),
    [list, now],
  )
  const recent = useMemo(
    () => list.filter((f) => !['NS', 'TBD'].includes(f.status.short)).slice(-8).reverse(),
    [list],
  )

  if (error) return <ErrorBox message={error} />
  if (!team) return <div className="card h-40 animate-pulse opacity-50" />

  const v = team.venue

  return (
    <div className="space-y-4">
      <section className="card flex items-center gap-4 p-4">
        <img src={team.team.logo} alt="" className="h-16 w-16" />
        <div>
          <h1 className="text-xl font-bold">{team.team.name}</h1>
          <p className="text-sm text-slate-400">
            {team.team.national ? 'National team' : team.team.country}
            {team.team.founded ? ` · Founded ${team.team.founded}` : ''}
            {team.team.code ? ` · ${team.team.code}` : ''}
          </p>
        </div>
      </section>

      {v && (
        <section className="card p-4 text-sm">
          <h3 className="mb-2 font-semibold">Venue</h3>
          <div className="grid gap-1 text-slate-300 sm:grid-cols-2">
            <span>🏟️ {v.name}</span>
            <span>📍 {v.city}</span>
            <span>👥 {v.capacity?.toLocaleString()} capacity</span>
            <span>🌱 {v.surface || 'grass'}</span>
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="card overflow-hidden">
          <header className="border-b border-line px-4 py-2 font-semibold">Upcoming</header>
          <div className="divide-y divide-line/60">
            {upcoming.map((f) => <MatchRow key={f.fixture.id} fixture={f} />)}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="card overflow-hidden">
          <header className="border-b border-line px-4 py-2 font-semibold">Recent results</header>
          <div className="divide-y divide-line/60">
            {recent.map((f) => <MatchRow key={f.fixture.id} fixture={f} />)}
          </div>
        </section>
      )}

      {!fixtures && !error && <div className="card h-32 animate-pulse opacity-50" />}
    </div>
  )
}
