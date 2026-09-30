# GoalPulse — Football live scores, predictions & bet builder

Live football matches, standings, team profiles, community voting and a
"Bet Builder" that enumerates every winning combination across your selected
matches — powered by [football-data.org](https://www.football-data.org) (v4 API).

## Stack

- **Frontend:** React 19 + Vite + Tailwind CSS v4 + React Router
- **Backend:** Netlify Functions (serverless proxy that keeps the API key secret and caches responses)
- **Deploy:** Netlify (SPA + functions in one deploy)

## Run locally

```bash
npm install
npm run netlify:dev   # http://localhost:8888  (frontend + /api functions)
# or, without functions:
npm run dev           # http://localhost:5173  (needs netlify dev running for /api)
```

Create `.env`:

```
FOOTBALL_DATA_API_KEY=your_football_data_org_token
```

## Deploy

1. Push this repo to GitHub.
2. On [Netlify](https://app.netlify.com): **Add new site → Import from GitHub**.
3. Build command `npm run build`, publish directory `dist` (see `netlify.toml`).
4. Add environment variable `FOOTBALL_DATA_API_KEY` (Site settings → Environment variables).
5. Deploy.

## Notes on the free API plan (football-data.org)

- 10 requests/minute; 12 competitions covered (PL, La Liga, Serie A, Bundesliga,
  Ligue 1, UCL, Eredivisie, Primeira Liga, Championship, Brasileirão,
  Libertadores, World Cup, Euro).
- **Standings always show the current season.**
- The Netlify function keeps a **persistent cache on Netlify Blobs** (survives
  cold starts and redeploys) and enforces a daily request budget (see
  `/api/fetch?ep=__status`). Once spent, cached-but-expired data is served stale.
- Predictions & odds are **model estimates**: the free plan has no odds or
  predictions endpoints, so the serverless function computes them from current
  standings with a Poisson goals model. They are labelled as estimates in the UI.
- Player statistics are not available on the free plan (the player page explains this).
