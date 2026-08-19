/**
 * License shop cloud: khoá / hết hạn. Cache local để tôn trọng lần check gần nhất khi offline.
 */
import { getMeta, setMeta } from '../db'

export type LicenseStatus = 'trial' | 'active' | 'expired' | 'locked'

export interface ShopLicense {
  shopId?: string
  status: LicenseStatus
  expiresAt: number | null
  name?: string
  plan?: string
  reason?: string
}

const KEY = 'cloud:license'

const listeners = new Set<(lic: ShopLicense | null) => void>()

export function isLicenseBlocked(lic: ShopLicense | null | undefined): boolean {
  if (!lic) return false
  if (lic.status === 'locked' || lic.status === 'expired') return true
  if (lic.expiresAt != null && lic.expiresAt < Date.now()) return true
  return false
}

export function licenseFromApiError(msg: string): ShopLicense | null {
  if (msg === 'SHOP_LOCKED') return { status: 'locked', expiresAt: null }
  if (msg === 'SHOP_EXPIRED') return { status: 'expired', expiresAt: Date.now() - 1 }
  return null
}

export async function loadCachedLicense(): Promise<ShopLicense | null> {
  return getMeta<ShopLicense | null>(KEY, null)
}

export async function saveCachedLicense(lic: ShopLicense | null): Promise<void> {
  await setMeta(KEY, lic)
  listeners.forEach((fn) => fn(lic))
}

export function watchLicense(fn: (lic: ShopLicense | null) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export async function applyLicenseError(msg: string): Promise<void> {
  const next = licenseFromApiError(msg)
  if (!next) return
  const prev = await loadCachedLicense()
  await saveCachedLicense({ ...prev, ...next })
}

export function licenseFromShopRow(row: {
  shopId?: string
  name?: string
  status?: string
  plan?: string
  expiresAt?: number | null
  lockedReason?: string
}): ShopLicense {
  const status: LicenseStatus =
    row.status === 'locked' || row.status === 'expired' || row.status === 'trial' || row.status === 'active'
      ? row.status
      : 'active'
  return {
    shopId: row.shopId,
    status,
    expiresAt: row.expiresAt ?? null,
    name: row.name,
    plan: row.plan,
    reason: row.lockedReason,
  }
}
