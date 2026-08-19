/** Derived admin fields — no server calls. */
import type { AdminShop } from './api'

export type ShopHealth = 'sống' | 'chậm' | 'offline' | 'khoá'
export type AlertReason = 'sync_stale' | 'expiring' | 'expired' | 'locked'
export type FleetFilter = 'all' | ShopHealth | 'expiring'

const HOUR = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR

export const HEALTH_LABEL: Record<ShopHealth, string> = {
  sống: 'Sống',
  chậm: 'Chậm',
  offline: 'Offline',
  khoá: 'Khoá',
}

export const ALERT_LABEL: Record<AlertReason, string> = {
  sync_stale: 'Không sync > 48 giờ',
  expiring: 'Sắp hết hạn (≤ 7 ngày)',
  expired: 'Đã hết hạn',
  locked: 'Đã khoá',
}

export const PLAN_LABEL: Record<string, string> = {
  trial: 'Trial',
  basic: 'Basic',
  premium: 'Premium',
}

export function shopHealth(shop: Pick<AdminShop, 'status' | 'lastOpAt'>, now = Date.now()): ShopHealth {
  if (shop.status === 'locked') return 'khoá'
  if (shop.lastOpAt && now - shop.lastOpAt < HOUR) return 'sống'
  if (shop.lastOpAt && now - shop.lastOpAt < 24 * HOUR) return 'chậm'
  return 'offline'
}

export function daysLeftAt(expiresAt: number | null, now = Date.now()): number | null {
  if (expiresAt == null) return null
  return Math.ceil((expiresAt - now) / DAY_MS)
}

export function isExpiringSoon(shop: Pick<AdminShop, 'status' | 'expiresAt'>, now = Date.now()): boolean {
  if (shop.status === 'locked' || shop.expiresAt == null || shop.expiresAt < now) return false
  const left = daysLeftAt(shop.expiresAt, now)
  return left != null && left <= 7
}

export function shopAlertReasons(
  shop: Pick<AdminShop, 'status' | 'expiresAt' | 'lastOpAt'>,
  now = Date.now(),
): AlertReason[] {
  const reasons: AlertReason[] = []
  if (shop.status === 'locked') reasons.push('locked')
  if (shop.status === 'expired') reasons.push('expired')
  if ((shop.status === 'trial' || shop.status === 'active') && isExpiringSoon(shop, now)) {
    reasons.push('expiring')
  }
  if (shop.status !== 'locked' && (!shop.lastOpAt || now - shop.lastOpAt >= 48 * HOUR)) {
    reasons.push('sync_stale')
  }
  return reasons
}

export function licenseBar(
  shop: Pick<AdminShop, 'createdAt' | 'expiresAt'>,
  now = Date.now(),
): { unlimited: boolean; usedDays: number; totalDays: number; leftDays: number | null; fill: number } {
  const usedDays = Math.max(0, Math.floor((now - shop.createdAt) / DAY_MS))
  if (shop.expiresAt == null) {
    return { unlimited: true, usedDays, totalDays: 0, leftDays: null, fill: 0 }
  }
  const totalDays = Math.max(1, Math.ceil((shop.expiresAt - shop.createdAt) / DAY_MS))
  const leftDays = Math.ceil((shop.expiresAt - now) / DAY_MS)
  return { unlimited: false, usedDays, totalDays, leftDays, fill: Math.min(1, Math.max(0, usedDays / totalDays)) }
}

export function remainingTone(expiresAt: number | null, now = Date.now()): 'ok' | 'soon' | 'dead' {
  if (expiresAt == null) return 'dead'
  const left = daysLeftAt(expiresAt, now)
  if (left == null || left < 0) return 'dead'
  if (left <= 7) return 'soon'
  return 'ok'
}

export function vnDay(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now))
}

export function usageHeatmap14(
  usage: Array<{ day: string; seconds: number }> | undefined,
  now = Date.now(),
): Array<{ day: string; seconds: number }> {
  const map = new Map((usage ?? []).map((d) => [d.day, d.seconds]))
  const out: Array<{ day: string; seconds: number }> = []
  for (let i = 13; i >= 0; i--) {
    const day = vnDay(now - i * DAY_MS)
    out.push({ day, seconds: map.get(day) ?? 0 })
  }
  return out
}

export function matchesSearch(shop: AdminShop, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return [shop.name, shop.shopId, shop.ownerEmail, shop.ownerUid, shop.phone]
    .some((v) => (v || '').toLowerCase().includes(s))
}

export function filterFleet(shops: AdminShop[], q: string, filter: FleetFilter, now = Date.now()): AdminShop[] {
  return shops.filter((row) => {
    if (!matchesSearch(row, q)) return false
    if (filter === 'all') return true
    if (filter === 'expiring') return isExpiringSoon(row, now)
    return shopHealth(row, now) === filter
  })
}
