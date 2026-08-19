/**
 * Offline hardening: persist IndexedDB, Web Locks chống double-submit, BroadcastChannel đa tab.
 */

const CHANNEL = '3su-db'
let bc: BroadcastChannel | null = null

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function withExclusiveLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = navigator.locks
  if (!locks?.request) return fn()
  return locks.request(`3su:${name}`, { mode: 'exclusive' }, () => fn())
}

export function dbChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!bc) bc = new BroadcastChannel(CHANNEL)
  return bc
}

export function notifyDbChanged(): void {
  try { dbChannel()?.postMessage({ t: 'changed', at: Date.now() }) } catch { /* */ }
}

export function onDbChanged(fn: () => void): () => void {
  const ch = dbChannel()
  if (!ch) return () => {}
  const handler = () => fn()
  ch.addEventListener('message', handler)
  return () => ch.removeEventListener('message', handler)
}
