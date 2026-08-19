/**
 * Đếm giờ POS đang mở (tab hiện). Heartbeat 1 phút, nghỉ > 3 phút không tính.
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

type Pending = { shopId: string; day: string; seconds: number }

let shopId = ''
let lastBeat = 0
let pending = 0
let beatTimer: ReturnType<typeof setInterval> | null = null
let flushTimer: ReturnType<typeof setInterval> | null = null
let flushing = false

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

async function flush(target = shopId): Promise<void> {
  if (!target) return
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
    pending = Math.max(0, pending - seconds)
    writeStore(target, pending)
  } catch {
    writeStore(target, pending)
  } finally {
    flushing = false
  }
}

function heartbeat(): void {
  if (typeof document !== 'undefined' && document.hidden) return
  const now = Date.now()
  if (lastBeat && now - lastBeat < SESSION_GAP_MS) {
    pending += Math.floor((now - lastBeat) / 1000)
    writeStore(shopId, pending)
  }
  lastBeat = now
}

function onVis(): void {
  if (document.hidden) void flush()
  lastBeat = Date.now()
}

export function stopUsageTracker(): void {
  if (beatTimer) clearInterval(beatTimer)
  if (flushTimer) clearInterval(flushTimer)
  beatTimer = null
  flushTimer = null
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis)
  const id = shopId
  shopId = ''
  void flush(id)
}

export async function startUsageTracker(): Promise<void> {
  const id = await getCloudShopId()
  if (!id || !apiBase()) {
    stopUsageTracker()
    return
  }
  if (shopId === id && beatTimer) return
  stopUsageTracker()
  shopId = id
  lastBeat = Date.now()
  const stored = readStore()
  pending = stored && stored.shopId === id && stored.day === vnDay() ? stored.seconds : 0
  beatTimer = setInterval(heartbeat, HEARTBEAT_MS)
  flushTimer = setInterval(() => { void flush() }, FLUSH_MS)
  document.addEventListener('visibilitychange', onVis)
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
