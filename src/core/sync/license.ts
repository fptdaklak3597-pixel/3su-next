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
const CHECKED_AT_KEY = 'cloud:licenseCheckedAt'
/** Bound shops must refresh license within this window or local writes stop. */
export const LICENSE_CACHE_TTL_MS = 72 * 60 * 60 * 1000

const listeners = new Set<(lic: ShopLicense | null) => void>()

export function isLicenseBlocked(lic: ShopLicense | null | undefined): boolean {
  if (!lic) return false
  if (lic.status === 'locked' || lic.status === 'expired') return true
  if (lic.status !== 'active' && lic.status !== 'trial') return true
  if (lic.expiresAt != null && lic.expiresAt < Date.now()) return true
  return false
}

export async function isCachedLicenseFresh(): Promise<boolean> {
  const at = await getMeta<number>(CHECKED_AT_KEY, 0)
  if (!at) return false
  return Date.now() - at <= LICENSE_CACHE_TTL_MS
}

/** Cloud shop without a usable, fresh license cannot write the ledger. Local-only shops stay open. */
export async function assertCloudShopWritable(): Promise<void> {
  const shopId = await getMeta<string>('cloud:shopId', '')
  if (!shopId) return
  const lic = await loadCachedLicense()
  if (!lic || isLicenseBlocked(lic) || !(await isCachedLicenseFresh())) {
    throw new Error('Cửa hàng đã bị khóa hoặc chưa có giấy phép — không thể ghi sổ')
  }
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
  await setMeta(CHECKED_AT_KEY, Date.now())
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
      : 'locked'
  return {
    shopId: row.shopId,
    status,
    expiresAt: row.expiresAt ?? null,
    name: row.name,
    plan: row.plan,
    reason: row.lockedReason,
  }
}
