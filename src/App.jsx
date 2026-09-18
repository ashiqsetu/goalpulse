import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import MatchesPage from './pages/MatchesPage'
import MatchDetailPage from './pages/MatchDetailPage'
import StandingsPage from './pages/StandingsPage'
import TeamPage from './pages/TeamPage'
import PlayerPage from './pages/PlayerPage'
import BuilderPage from './pages/BuilderPage'
import HistoryPage from './pages/HistoryPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<MatchesPage />} />
          <Route path="/match/:fixtureId" element={<MatchDetailPage />} />
          <Route path="/standings" element={<StandingsPage />} />
          <Route path="/team/:teamId" element={<TeamPage />} />
          <Route path="/player/:playerId" element={<PlayerPage />} />
          <Route path="/builder" element={<BuilderPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="*" element={<div className="card p-8 text-center">Page not found</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
