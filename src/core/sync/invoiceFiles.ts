import { apiBase, getCloudShopId } from './cloud'
import { getCloudIdToken } from './firebase'
import { fetchWithTimeout } from './http'

export type InvoiceFileKind = 'xml' | 'xslt' | 'html'

function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

async function fetchInvoiceBytes(invId: string, kind: InvoiceFileKind): Promise<Uint8Array> {
  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) throw new Error('Chưa nối cloud')
  const token = await getCloudIdToken()
  const res = await fetchWithTimeout(
    `${base.replace(/\/+$/, '')}/v1/shops/${encodeURIComponent(shopId)}/invoices/${encodeURIComponent(invId)}/file?kind=${kind}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(res.status === 404 ? 'Chưa có file' : `Không tải được file (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function tryFetchInvoiceBytes(invId: string, kind: InvoiceFileKind): Promise<Uint8Array | null> {
  try {
    const bytes = await fetchInvoiceBytes(invId, kind)
    return bytes.length ? bytes : null
  } catch {
    return null
  }
}

export function invoiceFileText(bytes: Uint8Array | null): string {
  if (!bytes?.length || looksLikeZip(bytes)) return ''
  return new TextDecoder('utf-8').decode(bytes).trim()
}

export async function fetchInvoiceXml(invId: string): Promise<string> {
  const bytes = await fetchInvoiceBytes(invId, 'xml')
  const text = invoiceFileText(bytes)
  if (text) return text
  throw new Error('Chưa có file')
}

export async function tryFetchInvoiceFile(invId: string, kind: InvoiceFileKind): Promise<string> {
  return invoiceFileText(await tryFetchInvoiceBytes(invId, kind))
}
