/**
 * Cloud API for e-invoice module + authoritative command post.
 */
import type { CommandEnvelope, CommandResult } from '../authoritative/contracts'
import { ensureDeviceCredential } from '../authoritative/deviceCredential'
import { getThisDeviceId } from '../domain/devices'
import { apiGet, apiPost, fetchWithTimeout } from '../sync/http'
import { apiBase, getCloudShopId } from '../sync/cloud'
import { getCloudIdToken } from '../sync/firebase'

export interface EinvoiceReadiness {
  ready: boolean
  checks: Array<{ key: string; ok: boolean; message?: string }>
}

export interface QueuedInvoiceResponse {
  invoiceId: string
  state: string
  providerRefId?: string
  duplicate?: boolean
}

async function errText(res: Response): Promise<string> {
  try {
    const j = await res.json() as { error?: string; message?: string }
    return j.error || j.message || res.statusText
  } catch {
    return res.statusText
  }
}

export async function postShopCommand(envelope: CommandEnvelope): Promise<CommandResult> {
  const base = apiBase()
  const shopId = envelope.shopId || (await getCloudShopId())
  if (!base || !shopId) throw new Error('Chưa kết nối cloud shop')

  const secret = await ensureDeviceCredential()
  const deviceId = envelope.deviceId || await getThisDeviceId()
  const token = await getCloudIdToken()
  const res = await fetchWithTimeout(
    `${base.replace(/\/+$/, '')}/v1/shops/${encodeURIComponent(shopId)}/commands`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'X-Device-Id': deviceId,
        'X-Device-Secret': secret,
      },
      body: JSON.stringify(envelope),
    },
  )
  if (!res.ok) throw new Error(await errText(res))
  return res.json() as Promise<CommandResult>
}

export async function fetchEinvoiceReadiness(): Promise<EinvoiceReadiness> {
  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) throw new Error('Chưa kết nối cloud')
  return apiGet(base, `/v1/shops/${encodeURIComponent(shopId)}/einvoice/readiness`, getCloudIdToken)
}

export async function queueEinvoiceFromSale(body: {
  sale: {
    saleId: string
    shopId: string
    total: number
    occurredAt: string
    items: Array<{ productId: string; name: string; qty: number; price: number; unit?: string }>
    payMethod: string
    customerId?: string
  }
  complianceDecisionId?: string
  policyVersion?: string
}): Promise<QueuedInvoiceResponse> {
  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) throw new Error('Chưa kết nối cloud')
  return apiPost(
    base,
    `/v1/shops/${encodeURIComponent(shopId)}/einvoice/queue-from-sale`,
    getCloudIdToken,
    body,
  )
}

export async function fetchEinvoiceBySale(saleId: string): Promise<Record<string, unknown>> {
  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) throw new Error('Chưa kết nối cloud')
  return apiGet(
    base,
    `/v1/shops/${encodeURIComponent(shopId)}/einvoice/by-sale/${encodeURIComponent(saleId)}`,
    getCloudIdToken,
  )
}
