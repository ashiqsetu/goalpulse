# GoalPulse — Football live scores, predictions & bet builder

Live football matches, standings, team/player profiles, community voting and a
"Bet Builder" that enumerates every winning combination across your selected
matches — powered by [api-football](https://www.api-football.com) (v3.football.api-sports.io).

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
V3_FOOTBALL_API_KEY=your_api_football_key
```

## Deploy

1. Push this repo to GitHub.
2. On [Netlify](https://app.netlify.com): **Add new site → Import from GitHub**.
3. Build command `npm run build`, publish directory `dist` (see `netlify.toml`).
4. Add environment variable `V3_FOOTBALL_API_KEY` (Site settings → Environment variables).
5. Deploy.

## Notes on the free API plan

- 10 requests/minute, 100 requests/day — the serverless function caches per endpoint.
- Predictions & odds: available for current seasons.
- Standings: free plan covers seasons 2022–2024 (the app defaults to the last available season and notes this in the UI).
