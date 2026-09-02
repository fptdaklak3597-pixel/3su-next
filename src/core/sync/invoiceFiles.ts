import { apiBase, getCloudShopId } from './cloud'
import { getCloudIdToken } from './firebase'
import { fetchWithTimeout } from './http'

export async function fetchInvoiceXml(invId: string): Promise<string> {
  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) throw new Error('Chưa nối cloud')
  const token = await getCloudIdToken()
  const res = await fetchWithTimeout(
    `${base.replace(/\/+$/, '')}/v1/shops/${encodeURIComponent(shopId)}/invoices/${encodeURIComponent(invId)}/file?kind=xml`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(res.status === 404 ? 'Chưa có file XML' : `Không tải được XML (${res.status})`)
  return res.text()
}
