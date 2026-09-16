import { Link } from 'react-router-dom'
import { fmtTime, fmtStatus, isLive, isFinished } from '../lib/api'

function Team({ team, score, winner, fav }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <img src={team.logo} alt="" className="h-5 w-5 shrink-0" loading="lazy" />
      <span className={`truncate text-sm ${winner ? 'font-bold' : ''} ${fav ? 'text-grass' : ''}`}>
        {team.name}
      </span>
      {fav && <span title="Bookmakers' favorite" className="text-[10px] text-gold">★</span>}
      <span className="ml-auto pl-2 text-sm font-semibold tabular-nums">{score}</span>
    </div>
  )
}

export default function MatchRow({ fixture: f, favorite }) {
  const live = isLive(f)
  const finished = isFinished(f)
  const started = live || finished
  return (
    <Link
      to={`/match/${f.fixture.id}`}
      className="block rounded-lg px-3 py-2 transition hover:bg-white/5"
    >
      <div className="flex items-center gap-2">
        <div className="w-14 shrink-0 text-center text-xs">
          {live ? (
            <span className="flex items-center justify-center gap-1 font-bold text-live">
              <span className="live-dot" /> {fmtStatus(f)}
            </span>
          ) : finished ? (
            <span className="text-slate-500">FT</span>
          ) : (
            <span className="font-semibold text-slate-300">{fmtTime(f.date)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <Team
            team={f.teams.home}
            score={started ? f.goals.home : ''}
            winner={started && f.teams.home.winner === true}
            fav={favorite === 'H'}
          />
          <Team
            team={f.teams.away}
            score={started ? f.goals.away : ''}
            winner={started && f.teams.away.winner === true}
            fav={favorite === 'A'}
          />
        </div>
        <span className="shrink-0 text-xs text-slate-500">›</span>
      </div>
    </Link>
  )
}
