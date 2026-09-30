import { useParams, Link } from 'react-router-dom'
import ErrorBox from '../components/ErrorBox'

// Player statistics (squads, per-player season stats) are not part of the free
// data plan, so this route explains the limitation instead of showing a dead
// end. Teams remain browsable via matches and standings.
export default function PlayerPage() {
  const { playerId } = useParams()
  return (
    <div className="space-y-4">
      <ErrorBox message="Player profiles aren't available on the current data plan." />
      <div className="card p-6 text-sm text-slate-400">
        The free football-data.org tier doesn't include player statistics, so player
        page <span className="font-mono">#{playerId}</span> can't be shown. You can still
        browse <Link to="/" className="text-grass underline">matches</Link>,{' '}
        <Link to="/standings" className="text-grass underline">standings</Link> and{' '}
        <Link to="/builder" className="text-grass underline">the bet builder</Link>.
      </div>
    </div>
  )
}
