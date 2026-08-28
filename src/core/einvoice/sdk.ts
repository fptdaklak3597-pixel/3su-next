/**
 * Client SDK for @3su/einvoice cloud integration.
 */
export {
  fetchEinvoiceReadiness,
  fetchEinvoiceBySale,
  queueEinvoiceFromSale,
  postShopCommand,
  type EinvoiceReadiness,
  type QueuedInvoiceResponse,
} from './cloudApi'
export { confirmCheckout } from './checkoutFacade'
export { saleFromAuthoritativePayload } from './saleMapper'

import { apiBase, getCloudShopId } from '../sync/cloud'
import { getCloudIdToken } from '../sync/firebase'
import { fetchWithTimeout } from '../sync/http'

export interface EinvoiceProfileInput {
  revenueTier?: string
  cqtRegistrationAccepted?: boolean
  voluntaryEnabled?: boolean
  selectedSeries?: string
  autoIssue?: boolean
}

export async function upsertEinvoiceProfile(input: EinvoiceProfileInput): Promise<void> {
  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) throw new Error('Chưa kết nối cloud')
  const token = await getCloudIdToken()
  const res = await fetchWithTimeout(
    `${base.replace(/\/+$/, '')}/v1/shops/${encodeURIComponent(shopId)}/einvoice/profile`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || 'Không lưu hồ sơ HĐĐT')
  }
}

export async function processEinvoiceJobs(limit = 10): Promise<{ processed: number; issued: number; failed: number }> {
  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) throw new Error('Chưa kết nối cloud')
  const token = await getCloudIdToken()
  const res = await fetchWithTimeout(
    `${base.replace(/\/+$/, '')}/v1/shops/${encodeURIComponent(shopId)}/einvoice/process-jobs`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ limit }),
    },
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{ processed: number; issued: number; failed: number }>
}
