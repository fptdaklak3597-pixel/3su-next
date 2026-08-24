/**
 * Map Gemini scan JSON → ParsedInvoice (3su-next domain).
 */
import type { ParsedInvoice, ParsedItem } from '../domain/invoiceImport'
import { numVN } from '../domain/invoiceImport'
import { today } from '../format'

export function parseGeminiInvoiceJson(text: string): ParsedInvoice | null {
  try {
    const raw = JSON.parse(text) as {
      supplier?: string
      date?: string
      items?: Array<Record<string, unknown>>
      totals?: Record<string, unknown>
    }
    const items: ParsedItem[] = (raw.items ?? []).map((it) => ({
      name: String(it.name || '').trim(),
      sku: '',
      qty: numVN(it.qty) || 1,
      cost: numVN(it.cost),
      tax: numVN(it.tax),
      unit: String(it.unit || 'cái').trim() || 'cái',
      total: numVN(it.total),
      price: 0,
      unitRatio: null,
    })).filter((it) => it.name)
    if (!items.length) return null
    return {
      supplier: {
        name: String(raw.supplier || '').trim(),
        mst: '',
        phone: '',
        addr: '',
      },
      date: String(raw.date || today()).slice(0, 10),
      note: '',
      nbmst: '',
      khhdon: '',
      shdon: '',
      items,
      totals: {
        preTax: numVN(raw.totals?.preTax),
        tax: numVN(raw.totals?.tax),
        grand: numVN(raw.totals?.grand),
      },
      rawText: text,
    }
  } catch {
    return null
  }
}
