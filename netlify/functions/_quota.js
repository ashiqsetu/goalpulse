// Daily API request budget, persisted on Netlify Blobs so it survives cold
// starts and redeploys (Netlify instances reset frequently; memory alone
// would leak spend on every restart).
import { getStore } from '@netlify/blobs'

const STORE = 'gp-cache'
const NS = 'budget'
// Safety valve, not a provider limit: football-data.org's free plan is
// throttled per minute (10 req/min); the cache normally keeps us far below this.
const DAILY_CAP = 400

let store = null
let ok = null // tri-state: null untested, true/false known

function getStore_() {
  if (ok === false) return null
  if (store) return store
  try {
    store = getStore({ name: STORE })
    ok = true
    return store
  } catch {
    ok = false
    return null
  }
}

// UTC day bucket (the provider's quota day is UTC-aligned)
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10)

// Consume one unit of the daily budget. Returns 'allowed' | 'blocked'.
export async function consumeQuota() {
  const s = getStore_()
  if (!s) return 'allowed' // no persistence → don't hard-block, just can't count
  const key = `${NS}:${dayKey()}`
  try {
    const cur = (await s.get(key, { type: 'json' })) || { count: 0 }
    if ((cur.count || 0) >= DAILY_CAP) return 'blocked'
    await s.setJSON(key, { count: (cur.count || 0) + 1, updatedAt: Date.now() })
    return 'allowed'
  } catch {
    return 'allowed'
  }
}

// Diagnostic counts (used by the status endpoint)
export async function quotaSnapshot() {
  const s = getStore_()
  if (!s) return { cap: DAILY_CAP, used: null, day: dayKey(), persistent: false }
  try {
    const cur = (await s.get(`${NS}:${dayKey()}`, { type: 'json' })) || { count: 0 }
    return { cap: DAILY_CAP, used: cur.count || 0, day: dayKey(), persistent: true }
  } catch {
    return { cap: DAILY_CAP, used: null, day: dayKey(), persistent: false }
  }
}

export const DAILY_LIMIT = DAILY_CAP
