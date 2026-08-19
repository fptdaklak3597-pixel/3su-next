/**
 * Phiên cloud: cùng email chủ → cùng cửa hàng.
 * Máy mới / nhân viên: nhập mã một lần, dùng Gmail của họ.
 */
import { dbx, getMeta, setCurrentUser, setMeta } from '../db'
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

const DATA_SHOP_KEY = 'data:shopId'
const CLOUD_UID_KEY = 'cloud:uid'
const CLOUD_BINDING_KEYS = ['cloud:shopId', 'cloud:role', CLOUD_UID_KEY] as const

export class CloudTenantConflictError extends Error {
  constructor(readonly dataShopId: string, readonly requestedShopId: string) {
    super(`Dữ liệu trên máy thuộc cửa hàng ${dataShopId}; không thể nối sang cửa hàng ${requestedShopId}. Hãy xuất sao lưu rồi xóa dữ liệu máy trước.`)
    this.name = 'CloudTenantConflictError'
  }
}

/** URL Worker tùy chỉnh chỉ dành cho môi trường phát triển. */
let apiBaseOverride = ''

function stripTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

/** Pure policy để test: production không bao giờ chấp nhận endpoint tùy chỉnh. */
export function normalizeApiBaseOverride(raw: string, production: boolean): string {
  const value = stripTrailingSlash(raw)
  if (!value || production) return ''
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error('Địa chỉ máy chủ không hợp lệ') }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Địa chỉ máy chủ không được chứa tài khoản, query hoặc fragment')
  }
  if (parsed.protocol === 'https:') return stripTrailingSlash(parsed.toString())
  if (parsed.protocol === 'http:' && isLocalHost(parsed.hostname)) return stripTrailingSlash(parsed.toString())
  throw new Error('Máy chủ phải dùng HTTPS; HTTP chỉ được dùng cho localhost')
}

function configuredApiBase(raw: string): string {
  const value = stripTrailingSlash(raw)
  if (!value) return ''
  try {
    const parsed = new URL(value)
    if (import.meta.env.PROD && parsed.protocol !== 'https:') return ''
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalHost(parsed.hostname))) return ''
    return stripTrailingSlash(parsed.toString())
  } catch {
    return ''
  }
}

function envApiBase(): string {
  const fromEnv = configuredApiBase((import.meta.env.VITE_API_BASE as string | undefined) || '')
  if (fromEnv) return fromEnv
  if (import.meta.env.PROD) return 'https://3su-cloud.3suspace.workers.dev'
  return ''
}

export function apiBase(): string {
  const base = import.meta.env.PROD ? envApiBase() : (apiBaseOverride || envApiBase())
  return stripTrailingSlash(base)
}

export async function loadApiBaseOverride(): Promise<string> {
  if (import.meta.env.PROD) {
    apiBaseOverride = ''
    await dbx.meta.delete('cloud:apiBase')
    return apiBase()
  }
  const saved = await getMeta<string>('cloud:apiBase', '')
  apiBaseOverride = normalizeApiBaseOverride(saved || '', false)
  return apiBase()
}

export async function saveApiBaseOverride(url: string): Promise<string> {
  if (import.meta.env.PROD) {
    apiBaseOverride = ''
    await dbx.meta.delete('cloud:apiBase')
    return apiBase()
  }
  apiBaseOverride = normalizeApiBaseOverride(url, false)
  await setMeta('cloud:apiBase', apiBaseOverride)
  return apiBase()
}

export async function getCloudShopId(): Promise<string | null> {
  return getMeta<string | null>('cloud:shopId', null)
}

export async function getCloudRole(): Promise<string | null> {
  return getMeta<string | null>('cloud:role', null)
}

export async function getDataShopId(): Promise<string | null> {
  return getMeta<string | null>(DATA_SHOP_KEY, null)
}

/** Pure invariant: một IndexedDB hiện hành chỉ được gắn với một shop. */
export function assertTenantBinding(existingShopId: string | null, requestedShopId: string): void {
  if (!requestedShopId) throw new Error('Thiếu mã cửa hàng')
  if (existingShopId && existingShopId !== requestedShopId) {
    throw new CloudTenantConflictError(existingShopId, requestedShopId)
  }
}

/**
 * Chọn shop an toàn:
 * - dữ liệu đã gắn shop nào thì chỉ chọn shop đó;
 * - nếu chưa gắn, ưu tiên shop đã nhớ còn hợp lệ;
 * - chỉ tự chọn khi tài khoản có đúng một shop.
 */
export function selectShopForSession(
  shops: CloudShopRow[],
  rememberedShopId: string | null,
  dataShopId: string | null,
): CloudShopRow | null {
  if (dataShopId) return shops.find((shop) => shop.shopId === dataShopId) ?? null
  if (rememberedShopId) {
    const remembered = shops.find((shop) => shop.shopId === rememberedShopId)
    if (remembered) return remembered
  }
  return shops.length === 1 ? shops[0]! : null
}

async function bindDataToShop(shopId: string): Promise<void> {
  const current = await getDataShopId()
  assertTenantBinding(current, shopId)
  if (!current) await setMeta(DATA_SHOP_KEY, shopId)
}

async function rememberShop(shopId: string, role?: string): Promise<void> {
  await bindDataToShop(shopId)
  const uid = getFirebaseAuth()?.currentUser?.uid || ''
  await dbx.transaction('rw', dbx.meta, async () => {
    await setMeta('cloud:shopId', shopId)
    await setMeta('cloud:role', role || '')
    await setMeta(CLOUD_UID_KEY, uid)
  })
}

async function forgetCloudBinding(): Promise<void> {
  disconnectTransport()
  setCloudPaused(false)
  await dbx.transaction('rw', dbx.meta, async () => {
    await dbx.meta.bulkDelete(Array.from(CLOUD_BINDING_KEYS))
    await setMeta('cloud:paused', false)
  })
  await saveCachedLicense(null)
}

/**
 * Dọn identity/session nhưng giữ data:shopId để dữ liệu không thể bị nối sang tenant khác.
 * Không giữ trạng thái pause do identity cũ; lần đăng nhập tiếp theo được phép xác minh lại.
 */
export async function clearCloudSession(): Promise<void> {
  disconnectTransport()
  setCloudPaused(false)
  await dbx.transaction('rw', dbx.meta, async () => {
    await dbx.meta.bulkDelete(Array.from(CLOUD_BINDING_KEYS))
    await setMeta('cloud:paused', false)
  })
  await saveCachedLicense(null)
  await setCurrentUser(null)
}

export async function listCloudShops(): Promise<CloudShopRow[]> {
  const base = apiBase()
  if (!base) return []
  const res = await apiGet<{ shops: CloudShopRow[] }>(base, '/v1/me/shops', getCloudIdToken)
  return Array.isArray(res.shops) ? res.shops.filter((shop) => !!shop?.shopId) : []
}

/** Xác minh và chọn một shop cụ thể từ membership server. */
export async function selectCloudShop(shopId: string): Promise<string> {
  const shops = await listCloudShops()
  const row = shops.find((shop) => shop.shopId === shopId)
  if (!row) throw new Error('Tài khoản không còn quyền vào cửa hàng này')
  await rememberShop(row.shopId, row.role)
  await saveCachedLicense(licenseFromShopRow(row))
  return row.shopId
}

/** Cùng tài khoản Firebase → xác minh shop theo membership server. */
export async function attachExistingCloudShop(): Promise<string | null> {
  const base = apiBase()
  if (!base) return null
  const [shops, rememberedShopId, dataShopId] = await Promise.all([
    listCloudShops(),
    getCloudShopId(),
    getDataShopId(),
  ])
  const selected = selectShopForSession(shops, rememberedShopId, dataShopId)
  if (!selected) {
    if (rememberedShopId && !shops.some((shop) => shop.shopId === rememberedShopId)) {
      await forgetCloudBinding()
    }
    return null
  }
  await rememberShop(selected.shopId, selected.role)
  await saveCachedLicense(licenseFromShopRow(selected))
  return selected.shopId
}

/** Đọc license mới nhất từ server (sau login / khi admin khoá). */
export async function refreshShopLicense(): Promise<ShopLicense | null> {
  const base = apiBase()
  if (!base) return null
  const shopId = await getCloudShopId()
  if (!shopId) return null
  const shops = await listCloudShops()
  const row = shops.find((shop) => shop.shopId === shopId)
  if (!row) {
    await forgetCloudBinding()
    return null
  }
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

/** Vào shop đã xác minh. Không tự tạo shop mới. */
export async function enterExistingCloudShop(): Promise<string | null> {
  const id = await attachExistingCloudShop()
  if (!id) return null
  if (isCloudPausedMem() || await isCloudPaused()) return id
  await connectCloud()
  return id
}

/** Vào shop đã có, hoặc theo mã ghép. Không tự tạo cửa hàng mới. */
export async function ensureCloudShop(pairCode?: string): Promise<string> {
  const existing = await enterExistingCloudShop()
  if (existing) return existing
  const code = pairCode?.trim().toUpperCase()
  if (code) {
    const shopId = await redeemPairCode(code)
    await connectCloud({ resume: true })
    return shopId
  }
  throw new Error('Chưa vào cửa hàng. Chọn cửa hàng, tạo mới hoặc nhập mã.')
}

export async function createPairCode(): Promise<{ code: string; expiresAt: number }> {
  const shopId = await getCloudShopId()
  if (!shopId) throw new Error('Chưa có cửa hàng cloud')
  const base = apiBase()
  if (!base) throw new Error('Chưa cấu hình máy chủ')
  return apiPost(base, `/v1/shops/${encodeURIComponent(shopId)}/pair`, getCloudIdToken)
}

export async function redeemPairCode(code: string): Promise<string> {
  const cleaned = code.trim().toUpperCase()
  if (!cleaned) throw new Error('Nhập mã vào cửa hàng')
  const base = apiBase()
  if (!base) throw new Error('Chưa cấu hình máy chủ')
  const res = await apiPost<{ shopId: string; role?: string }>(base, '/v1/pair/redeem', getCloudIdToken, { code: cleaned })
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
  const shopId = await attachExistingCloudShop()
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

/** Tạm ngắt cloud nhưng vẫn giữ binding cùng shop. */
export async function disconnectCloud(): Promise<void> {
  disconnectTransport()
  await setMeta('cloud:paused', true)
}
