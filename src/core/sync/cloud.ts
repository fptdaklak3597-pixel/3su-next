/**
 * Phiên cloud: cùng email chủ → cùng cửa hàng.
 * Máy mới / nhân viên: nhập mã một lần, dùng Gmail của họ.
 */
import { getMeta, setMeta } from '../db'
import { apiGet, apiPost, createHttpTransport } from './http'
import { getCloudIdToken, getFirebaseAuth, isCloudEmailPending, isFirebaseConfigured, waitCloudUser } from './firebase'
import { licenseFromShopRow, saveCachedLicense, type ShopLicense } from './license'
import { disconnectTransport, flushQueue, handleServerMsg, isCloudPausedMem, setCloudPaused, setSyncMode, setTransport } from './engine'

export type CloudShopRow = {
  shopId: string
  role?: string
  name?: string
  status?: string
  plan?: string
  expiresAt?: number | null
  lockedReason?: string
}

/** URL Worker dán trong Cài đặt — ưu tiên hơn VITE_API_BASE. */
let apiBaseOverride = ''

function envApiBase(): string {
  const fromEnv = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '') || ''
  if (fromEnv) return fromEnv
  if (import.meta.env.PROD) return 'https://3su-cloud.3suspace.workers.dev'
  return ''
}

export function apiBase(): string {
  return (apiBaseOverride || envApiBase()).replace(/\/+$/, '')
}

export async function loadApiBaseOverride(): Promise<string> {
  const saved = await getMeta<string>('cloud:apiBase', '')
  apiBaseOverride = (saved || '').trim().replace(/\/+$/, '')
  return apiBase()
}

export async function saveApiBaseOverride(url: string): Promise<string> {
  apiBaseOverride = url.trim().replace(/\/+$/, '')
  await setMeta('cloud:apiBase', apiBaseOverride)
  return apiBase()
}

export async function getCloudShopId(): Promise<string | null> {
  return getMeta<string | null>('cloud:shopId', null)
}

export async function getCloudRole(): Promise<string | null> {
  return getMeta<string | null>('cloud:role', null)
}

async function rememberShop(shopId: string, role?: string): Promise<void> {
  await setMeta('cloud:shopId', shopId)
  if (role) await setMeta('cloud:role', role)
}

/** Cùng tài khoản Firebase → lấy shop đã có (theo email/uid phía server). */
export async function attachExistingCloudShop(): Promise<string | null> {
  const existing = await getCloudShopId()
  if (existing) return existing
  const base = apiBase()
  if (!base) return null
  const res = await apiGet<{ shops: CloudShopRow[] }>(base, '/v1/me/shops', getCloudIdToken)
  const first = res.shops[0]
  if (!first?.shopId) return null
  await rememberShop(first.shopId, first.role)
  await saveCachedLicense(licenseFromShopRow(first))
  return first.shopId
}

/** Đọc license mới nhất từ server (sau login / khi admin khoá). */
export async function refreshShopLicense(): Promise<ShopLicense | null> {
  const base = apiBase()
  if (!base) return null
  const shopId = await getCloudShopId()
  const res = await apiGet<{ shops: CloudShopRow[] }>(base, '/v1/me/shops', getCloudIdToken)
  const row = (shopId && res.shops.find((s) => s.shopId === shopId)) || res.shops[0]
  if (!row) return null
  const lic = licenseFromShopRow(row)
  await saveCachedLicense(lic)
  return lic
}

export async function createCloudShop(): Promise<string> {
  const base = apiBase()
  if (!base) throw new Error('Chưa cấu hình địa chỉ máy chủ đồng bộ')
  const res = await apiPost<{ shopId: string; role?: string }>(base, '/v1/shops', getCloudIdToken)
  await rememberShop(res.shopId, res.role || 'owner')
  return res.shopId
}

/** Vào shop đã có trên máy hoặc cùng email. Không tự tạo shop mới. */
export async function enterExistingCloudShop(): Promise<string | null> {
  const id = (await getCloudShopId()) || (await attachExistingCloudShop())
  if (!id) return null
  if (isCloudPausedMem() || await isCloudPaused()) return id
  await connectCloud()
  return id
}

/**
 * Vào shop đã có, hoặc theo mã ghép. Không tự tạo cửa hàng mới.
 */
export async function ensureCloudShop(pairCode?: string): Promise<string> {
  const existing = await enterExistingCloudShop()
  if (existing) return existing
  const code = pairCode?.trim().toUpperCase()
  if (code) {
    const shopId = await redeemPairCode(code)
    await connectCloud()
    return shopId
  }
  throw new Error('Chưa vào cửa hàng. Tạo cửa hàng mới hoặc nhập mã.')
}

export async function createPairCode(): Promise<{ code: string; expiresAt: number }> {
  const shopId = await getCloudShopId()
  if (!shopId) throw new Error('Chưa có cửa hàng cloud')
  return apiPost(apiBase(), `/v1/shops/${encodeURIComponent(shopId)}/pair`, getCloudIdToken)
}

export async function redeemPairCode(code: string): Promise<string> {
  const cleaned = code.trim().toUpperCase()
  if (!cleaned) throw new Error('Nhập mã vào cửa hàng')
  const res = await apiPost<{ shopId: string; role?: string }>(apiBase(), '/v1/pair/redeem', getCloudIdToken, { code: cleaned })
  await rememberShop(res.shopId, res.role || 'staff')
  return res.shopId
}

export async function isCloudPaused(): Promise<boolean> {
  return getMeta<boolean>('cloud:paused', false)
}

export async function connectCloud(opts?: { resume?: boolean }): Promise<boolean> {
  if (opts?.resume) {
    setCloudPaused(false)
    await setMeta('cloud:paused', false)
  } else if (isCloudPausedMem() || await isCloudPaused()) {
    setCloudPaused(true)
    return false
  }
  if (!isFirebaseConfigured() || !apiBase()) return false
  await waitCloudUser()
  const auth = getFirebaseAuth()
  const user = auth?.currentUser
  if (!user || isCloudEmailPending(user)) return false
  const shopId = (await getCloudShopId()) || (await attachExistingCloudShop())
  if (!shopId) return false
  const t = createHttpTransport({ baseUrl: apiBase(), shopId, getToken: getCloudIdToken })
  setTransport(t)
  setSyncMode('sync')
  t.connect(handleServerMsg)
  try { await refreshShopLicense() } catch { /* offline */ }
  await flushQueue()
  void import('../browser/printQueue').then((m) => m.refreshPrintAgentStatus()).catch(() => {})
  return true
}

export async function disconnectCloud(): Promise<void> {
  disconnectTransport()
  await setMeta('cloud:paused', true)
}
