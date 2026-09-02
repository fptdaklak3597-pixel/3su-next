import { persistInvoiceDraft } from './drafts'
import { parseEInvoiceXML, type ParsedInvoice } from './invoiceImport'
import { fillFromXml, renderInvoiceHtml, type GdtInvoiceForm } from './invoiceGdtHtml'
import { fetchInvoiceXml } from '../sync/invoiceFiles'
import type { InvoiceRecord } from '../types'
import { invoiceExtra, invoiceTotal } from './invoices'

export function gdtFormFromRecord(inv: InvoiceRecord): GdtInvoiceForm {
  const extra = invoiceExtra(inv)
  return {
    khhdon: extra.khhdon,
    shdon: extra.shdon,
    khmshdon: extra.khmshdon,
    nbten: extra.sellerName,
    nbmst: extra.nbmst,
    tdlap: inv.date,
    tgtcthue: inv.amount,
    tgtthue: inv.tax,
    tgtttbso: invoiceTotal(inv),
    hdhhdvu: (extra.items || []).map((it) => ({
      ten: it.name,
      thhdvu: it.name,
      sluong: it.qty,
      dgia: it.price,
      thtien: it.qty * it.price,
    })),
  }
}

export function gdtHtmlForInvoice(inv: InvoiceRecord, xml?: string): string {
  const base = gdtFormFromRecord(inv)
  const filled = xml ? fillFromXml(base, xml) : base
  return renderInvoiceHtml(filled, filled)
}

export async function loadInvoiceXmlPreview(inv: InvoiceRecord): Promise<{ xml: string; parsed: ParsedInvoice; html: string }> {
  const xml = await fetchInvoiceXml(inv.id)
  return { xml, parsed: parseEInvoiceXML(xml), html: gdtHtmlForInvoice(inv, xml) }
}

export function printInvoiceHtml(html: string): boolean {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  w.print()
  return true
}

export async function draftImportFromInvoice(inv: InvoiceRecord, parsed: ParsedInvoice): Promise<void> {
  const extra = invoiceExtra(inv)
  await persistInvoiceDraft({
    inv: parsed,
    rows: [],
    supName: parsed.supplier.name || extra.sellerName || '',
    supId: '',
    date: parsed.date || inv.date,
    expiry: '',
    paid: 0,
    payMethod: 'cash',
    sourceInvoiceId: inv.id,
  })
}

export function downloadXmlBlob(xml: string, filename: string): void {
  const blob = new Blob([xml], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
