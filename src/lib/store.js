// localStorage-backed state for the Bet Builder picks and bet history.
// Bets are placed with a timestamp; results are graded against real fixtures later.

const SLIP_KEY = 'gp_slip'
const HISTORY_KEY = 'gp_history'

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage full / blocked */ }
}

const notify = () => window.dispatchEvent(new Event('gp:store'))

// ---------------------------------------------------------------- Bet slip

export function loadSlip() {
  // Drop corrupted/legacy entries without a fixture — they break the builder.
  return read(SLIP_KEY, []).filter((e) => e?.fixture?.id != null)
}

export function saveSlip(entries) {
  write(SLIP_KEY, entries)
  notify()
}

export function addToSlip(fixture) {
  // Stores the full fixture object so the builder can render it offline.
  const id = fixture?.fixture?.id
  if (!id) return
  const slip = loadSlip().filter((e) => e?.fixture?.id !== id)
  saveSlip([...slip, fixture])
}

export function removeFromSlip(fixtureId) {
  saveSlip(loadSlip().filter((e) => e?.fixture?.id !== fixtureId))
}

export function clearSlip() {
  saveSlip([])
}

// ---------------------------------------------------------------- History

// bet: {
//   id, placedAt, matches: [{ fixtureId, label, kickoff }],
//   variations: [{ picks: ['H'|'DC_H'|...], legOdds: [..], combinedOdds, stake }],
//   budget,
//   results: { [fixtureId]: 'H'|'D'|'A' } | null,  // graded outcome per match
// }
export function loadHistory() {
  return read(HISTORY_KEY, [])
}

export function saveHistory(list) {
  write(HISTORY_KEY, list)
  notify()
}

export function placeBet({ matches, variations, budget }) {
  const bet = {
    id: `bet_${Date.now()}`,
    placedAt: new Date().toISOString(),
    matches,
    variations,
    budget,
    results: null,
  }
  saveHistory([bet, ...loadHistory()])
  return bet
}

export function deleteBet(id) {
  saveHistory(loadHistory().filter((b) => b.id !== id))
}

export function gradeBet(id, results) {
  // results: { [fixtureId]: 'H' | 'D' | 'A' }
  const history = loadHistory()
  const bet = history.find((b) => b.id === id)
  if (!bet) return null
  bet.results = results
  saveHistory(history)
  return bet
}
