// Persistent server-side cache on Netlify Blobs (survives cold starts).
// Falls back to memory-only mode when Blobs isn't available (local `npm run dev`
// without netlify dev, missing env, etc.) — the app still works, just without
// cross-invocation persistence.
import { getStore } from '@netlify/blobs'

const STORE = 'gp-cache'
// v2: standings payloads cached before the derived home/away-splits + form fix
// had zeroed splits baked in — bumping the namespace invalidates them.
const NS = 'api-cache-v2'
const MAX_AGE_DAYS = 7 // prune response payloads after a week

let store = null
let blobsAvailable = null // tri-state: null = untested, true/false = known

const memory = new Map() // key -> { expires, payload } (L1 + fallback)

function getStore_() {
  if (blobsAvailable === false) return null
  if (store) return store
  try {
    store = getStore({ name: STORE })
    blobsAvailable = true
    return store
  } catch {
    blobsAvailable = false
    return null
  }
}

const memKey = (k) => `${NS}:${k}`

export async function cacheGet(key) {
  const mk = memKey(key)
  const hit = memory.get(mk)
  if (hit) {
    if (Date.now() <= hit.expires) return { payload: hit.payload, fresh: true }
    memory.delete(mk)
  }
  const s = getStore_()
  if (!s) return null
  try {
    const raw = await s.get(mk, { type: 'json' })
    if (!raw) return null
    const entry = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (Date.now() <= entry.expires) {
      memory.set(mk, entry) // promote to L1
      return { payload: entry.payload, fresh: true }
    }
    return { payload: entry.payload, fresh: false, stale: true }
  } catch {
    return null
  }
}

export async function cacheSet(key, payload, ttlSeconds) {
  const mk = memKey(key)
  const entry = { payload, expires: Date.now() + ttlSeconds * 1000, storedAt: Date.now() }
  memory.set(mk, entry)
  const s = getStore_()
  if (!s) return
  try {
    await s.setJSON(mk, entry)
  } catch { /* L1 still works */ }
}

export async function cacheGetStale(key) {
  const mk = memKey(key)
  const s = getStore_()
  if (!s) return null
  try {
    const raw = await s.get(mk, { type: 'json' })
    if (!raw) return null
    const entry = typeof raw === 'string' ? JSON.parse(raw) : raw
    return entry?.payload ?? null
  } catch {
    return null
  }
}

// Delete expired blobs so the store doesn't grow forever. Runs opportunistically
// at most once per hour (guarded by its own blob).
export async function pruneExpired() {
  const s = getStore_()
  if (!s) return
  const gateKey = `${NS}:__prune_gate__`
  try {
    const raw = await s.get(gateKey, { type: 'json' })
    if (raw && Date.now() < raw.next) return
    await s.setJSON(gateKey, { next: Date.now() + 3600 * 1000 })
    let cursor
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000
    do {
      const page = await s.list({ prefix: `${NS}:`, cursor })
      for (const b of page.blobs) {
        if (b.key === gateKey) continue
        const rawE = await s.get(b.key, { type: 'json' })
        const e = typeof rawE === 'string' ? JSON.parse(rawE) : rawE
        if (!e || (e.storedAt || 0) < cutoff) await s.delete(b.key)
      }
      cursor = page.cursor
    } while (cursor)
  } catch { /* pruning is best-effort */ }
}
