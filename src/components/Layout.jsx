import { NavLink, Outlet, Link } from 'react-router-dom'

const tabs = [
  { to: '/', label: 'Matches' },
  { to: '/builder', label: 'Bet Builder' },
  { to: '/standings', label: 'Table' },
]

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-pitch/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-2xl">⚽</span>
            <span className="text-lg font-bold tracking-tight">
              Goal<span className="text-grass">Pulse</span>
            </span>
          </Link>
          <nav className="ml-auto flex items-center gap-1 text-sm">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 transition ${
                    isActive ? 'bg-card text-grass font-semibold' : 'text-slate-300 hover:bg-card'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-line py-4 text-center text-xs text-slate-500">
        Data by api-football · Predictions are statistical estimates, not guarantees. Bet responsibly.
      </footer>
    </div>
  )
}
