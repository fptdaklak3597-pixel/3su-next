/**
 * Đếm giờ POS đang mở (tab hiện). Heartbeat 1 phút, nghỉ > 3 phút không tính.
 * Generation token chống race start/stop; navigator.locks chỉ 1 tab heartbeat.
 */
import { useEffect } from 'react'
import { apiBase, getCloudShopId } from './cloud'
import { getCloudIdToken } from './firebase'
import { apiPost } from './http'

const HEARTBEAT_MS = 60_000
const SESSION_GAP_MS = 3 * 60_000
const FLUSH_MS = 5 * 60_000
const MAX_FLUSH_SEC = 15 * 60
const STORE = '3su:usagePending'
const LOCK_NAME = '3su-usage-tracker'

type Pending = { shopId: string; day: string; seconds: number }

let shopId = ''
let lastBeat = 0
let pending = 0
let beatTimer: ReturnType<typeof setInterval> | null = null
let flushTimer: ReturnType<typeof setInterval> | null = null
let flushing = false
let generation = 0
let lockAbort: AbortController | null = null

function vnDay(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now))
}

function readStore(): Pending | null {
  try {
    const raw = localStorage.getItem(STORE)
    if (!raw) return null
    const p = JSON.parse(raw) as Pending
    if (!p.shopId || !p.day || !Number.isFinite(p.seconds)) return null
    return p
  } catch {
    return null
  }
}

function writeStore(shop: string, seconds: number): void {
  try {
    if (seconds <= 0) {
      localStorage.removeItem(STORE)
      return
    }
    localStorage.setItem(STORE, JSON.stringify({ shopId: shop, day: vnDay(), seconds }))
  } catch { /* */ }
}

async function flush(expectedGen: number, target = shopId): Promise<void> {
  if (expectedGen !== generation || !target) return
  const stored = readStore()
  if (stored && stored.shopId === target && stored.day === vnDay()) {
    pending = Math.max(pending, stored.seconds)
  }
  const seconds = Math.min(MAX_FLUSH_SEC, Math.floor(pending))
  if (seconds < 5 || flushing) return
  const base = apiBase()
  if (!base) return
  flushing = true
  try {
    await apiPost(base, `/v1/shops/${encodeURIComponent(target)}/usage`, getCloudIdToken, { seconds })
    if (expectedGen !== generation) return
    pending = Math.max(0, pending - seconds)
    writeStore(target, pending)
  } catch {
    writeStore(target, pending)
  } finally {
    flushing = false
  }
}

function heartbeat(expectedGen: number): void {
  if (expectedGen !== generation) return
  if (typeof document !== 'undefined' && document.hidden) return
  const now = Date.now()
  if (lastBeat && now - lastBeat < SESSION_GAP_MS) {
    pending += Math.floor((now - lastBeat) / 1000)
    writeStore(shopId, pending)
  }
  lastBeat = now
}

function onVis(expectedGen: number): void {
  if (expectedGen !== generation) return
  if (document.hidden) void flush(expectedGen)
  lastBeat = Date.now()
}

function clearTimers(): void {
  if (beatTimer) clearInterval(beatTimer)
  if (flushTimer) clearInterval(flushTimer)
  beatTimer = null
  flushTimer = null
}

export function stopUsageTracker(): void {
  generation += 1
  clearTimers()
  lockAbort?.abort()
  lockAbort = null
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisBound)
  }
  const id = shopId
  shopId = ''
  // Flush với gen hiện tại (sau bump) để không bị heartbeat cũ ghi đè
  void flush(generation, id)
}

let onVisBound = () => { /* replaced per start */ }

async function bindTimers(id: string, expectedGen: number): Promise<void> {
  if (expectedGen !== generation) return
  shopId = id
  lastBeat = Date.now()
  const stored = readStore()
  pending = stored && stored.shopId === id && stored.day === vnDay() ? stored.seconds : 0
  clearTimers()
  beatTimer = setInterval(() => heartbeat(expectedGen), HEARTBEAT_MS)
  flushTimer = setInterval(() => { void flush(expectedGen) }, FLUSH_MS)
  onVisBound = () => onVis(expectedGen)
  document.addEventListener('visibilitychange', onVisBound)
}

export async function startUsageTracker(): Promise<void> {
  const myGen = ++generation
  clearTimers()
  lockAbort?.abort()
  lockAbort = new AbortController()

  const id = await getCloudShopId()
  if (myGen !== generation) return
  if (!id || !apiBase()) {
    stopUsageTracker()
    return
  }

  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks?.request) {
    try {
      await locks.request(LOCK_NAME, { signal: lockAbort.signal }, async () => {
        if (myGen !== generation) return
        await bindTimers(id, myGen)
        // Giữ lock đến khi abort (stop / unmount / tab khác chiếm)
        await new Promise<void>((resolve) => {
          lockAbort?.signal.addEventListener('abort', () => resolve(), { once: true })
        })
      })
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      if (myGen === generation) await bindTimers(id, myGen)
    }
  } else {
    await bindTimers(id, myGen)
  }
}

export function useShopUsageTracker(active: boolean): void {
  useEffect(() => {
    if (!active) {
      stopUsageTracker()
      return
    }
    void startUsageTracker()
    return () => { stopUsageTracker() }
  }, [active])
}
