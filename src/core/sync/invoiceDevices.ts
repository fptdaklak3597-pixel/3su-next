/**
 * Client cho "Thiết bị hóa đơn" (desktop 3SU Invoice) — ghép nối device-link + danh sách/thu hồi.
 * Endpoints: 3su-cloud /v1/desktop/pair/* và /v1/shops/:id/devices.
 */
import { apiBase, getCloudRole, getCloudShopId } from './cloud'
import { getCloudIdToken } from './firebase'
import { apiGet, apiPost } from './http'

export interface InvoiceDeviceRow {
  deviceId: string
  uid: string
  status: string
  scope: string
  deviceName: string
  createdAt: number
  rotatedAt: number | null
  revokedAt: number | null
  expiresAt: number | null
  lastSeenAt: number | null
  gdtStatus?: string | null
  gdtStatusAt?: number | null
  lastScanAt?: number | null
}

export interface InvoicePairingInfo {
  code: string
  status: string
  deviceName: string
  createdAt: number
  expiresIn: number
}

export async function listInvoiceDevices(shopId: string): Promise<InvoiceDeviceRow[]> {
  const base = apiBase()
  if (!base || !shopId) return []
  const res = await apiGet<{ devices: InvoiceDeviceRow[] }>(
    base,
    `/v1/shops/${encodeURIComponent(shopId)}/devices`,
    getCloudIdToken,
  )
  return Array.isArray(res.devices) ? res.devices : []
}

export async function lookupInvoicePairing(code: string): Promise<InvoicePairingInfo> {
  const base = apiBase()
  if (!base) throw new Error('Chưa cấu hình API')
  return apiPost<InvoicePairingInfo>(base, '/v1/desktop/pair/lookup', getCloudIdToken, { code })
}

export async function approveInvoicePairing(code: string, shopId: string): Promise<void> {
  const base = apiBase()
  if (!base) throw new Error('Chưa cấu hình API')
  await apiPost<{ ok: boolean }>(base, '/v1/desktop/pair/approve', getCloudIdToken, { code, shopId })
}

export async function denyInvoicePairing(code: string, shopId: string): Promise<void> {
  const base = apiBase()
  if (!base) throw new Error('Chưa cấu hình API')
  await apiPost<{ ok: boolean }>(base, '/v1/desktop/pair/deny', getCloudIdToken, { code, shopId })
}

export function invoiceTaxLabel(row: InvoiceDeviceRow): string {
  if (row.gdtStatus === 'ok') return 'Thuế: đang đăng nhập'
  if (row.gdtStatus === 'auth_required') {
    const at = row.gdtStatusAt ? new Date(row.gdtStatusAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''
    return at ? `Cần đăng nhập lại từ ${at}` : 'Cần đăng nhập lại'
  }
  return 'Thuế: chưa có'
}

export async function revokeInvoiceDevice(shopId: string, deviceId: string): Promise<void> {
  const base = apiBase()
  if (!base) throw new Error('Chưa cấu hình API')
  await apiPost<{ ok: boolean }>(
    base,
    `/v1/shops/${encodeURIComponent(shopId)}/devices/credential/revoke`,
    getCloudIdToken,
    { deviceId },
  )
}

export async function currentShopForDevices(): Promise<string | null> {
  return getCloudShopId()
}

export async function currentRoleForDevices(): Promise<string> {
  return (await getCloudRole()) || ''
}
