/**
 * Feature flag + UI policy cho authoritative mode (Phase 6+).
 * Production: không bật được trừ khi VITE_ALLOW_AUTHORITATIVE=1 (saleCommands chưa wire UI).
 */
import { getMeta, setMeta } from '../db'
import { dbChannel } from '../offline'

const FLAG_KEY = 'authoritativeMoneyStock'

let cached: boolean | null = null
let flagChannelListening = false

type AuthoritativeFlagMsg = { t: 'authoritativeFlag'; on: boolean }

function isAuthoritativeFlagMsg(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const m = data as Record<string, unknown>
  return m.t === 'authoritativeFlag' && typeof m.on === 'boolean'
}

function allowAuthoritativeEnable(): boolean {
  if (import.meta.env.DEV) return true
  return import.meta.env.VITE_ALLOW_AUTHORITATIVE === '1'
}

function ensureAuthoritativeFlagChannel(): void {
  if (flagChannelListening) return
  flagChannelListening = true
  const ch = dbChannel()
  if (!ch) return
  ch.addEventListener('message', (ev: MessageEvent) => {
    if (isAuthoritativeFlagMsg(ev.data)) {
      const on = (ev.data as AuthoritativeFlagMsg).on
      cached = allowAuthoritativeEnable() ? on : false
    }
  })
}

export async function warmAuthoritativeMoneyStockCache(): Promise<boolean> {
  ensureAuthoritativeFlagChannel()
  const metaOn = (await getMeta<boolean>(FLAG_KEY, false)) === true
  // Meta true trên production không bật guard nếu chưa allow — tránh chân súng.
  const on = metaOn && allowAuthoritativeEnable()
  cached = on
  return on
}

export function getAuthoritativeMoneyStockCached(): boolean {
  return cached === true
}

export async function isAuthoritativeMoneyStockEnabled(): Promise<boolean> {
  if (cached !== null) return cached
  return warmAuthoritativeMoneyStockCache()
}

export async function setAuthoritativeMoneyStockEnabled(on: boolean): Promise<void> {
  ensureAuthoritativeFlagChannel()
  if (on && !allowAuthoritativeEnable()) {
    throw new Error(
      'Authoritative money/stock chưa sẵn sàng trên production. Bật DEV hoặc VITE_ALLOW_AUTHORITATIVE=1 khi chủ đích thử.',
    )
  }
  await setMeta(FLAG_KEY, on)
  cached = on
  try {
    dbChannel()?.postMessage({ t: 'authoritativeFlag', on } satisfies AuthoritativeFlagMsg)
  } catch {
    /* BroadcastChannel unavailable */
  }
}

export function resetAuthoritativeMoneyStockCacheForTests(): void {
  cached = null
}

export type SaleUiOutcome = 'confirmed' | 'pending' | 'conflict' | 'rejected'

/** Khi nào được in bill chính thức / clear cart kiểu đã chốt sổ */
export function canFinalizeSaleUi(outcome: SaleUiOutcome): boolean {
  return outcome === 'confirmed'
}

export function saleUiBanner(outcome: SaleUiOutcome): string {
  switch (outcome) {
    case 'confirmed':
      return 'Đã xác nhận'
    case 'pending':
      return 'Chờ đồng bộ — chưa vào sổ chính'
    case 'conflict':
      return 'Cần xử lý — xung đột tồn kho'
    case 'rejected':
      return 'Bị từ chối'
  }
}

export function mapResultToUiOutcome(status: 'accepted' | 'rejected' | 'conflict' | 'pending'): SaleUiOutcome {
  if (status === 'accepted') return 'confirmed'
  if (status === 'pending') return 'pending'
  return status
}
