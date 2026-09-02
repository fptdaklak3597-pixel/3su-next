import { persistInvoiceDraft } from './drafts'
import { parseEInvoiceXML, type ParsedInvoice } from './invoiceImport'
import {
  fillFromXml, renderInvoiceHtml, sanitizeOfflineHtml, transformXmlWithXslt,
  type GdtInvoiceForm,
} from './invoiceGdtHtml'
import { invoiceFileText, tryFetchInvoiceBytes } from '../sync/invoiceFiles'
import type { InvoiceRecord } from '../types'
import { invoiceExtra, invoiceTotal } from './invoices'

export function gdtFormFromRecord(inv: InvoiceRecord): GdtInvoiceForm {
  const extra = invoiceExtra(inv)
  const code = String(inv.code || '')
  const split = code.match(/^(.*)-(\d+)$/)
  return {
    khhdon: extra.khhdon || split?.[1] || '',
    shdon: extra.shdon || split?.[2] || '',
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
  return sanitizeOfflineHtml(renderInvoiceHtml(filled, filled, { embedded: true }))
}

export interface InvoicePreviewBundle {
  xml: string
  xslt: string
  gdtHtml: string
  printHtml: string
  parsed: ParsedInvoice | null
}

function looksLikeZipBytes(bytes: Uint8Array | null): boolean {
  return !!bytes && bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

async function unpackInvoiceZip(bytes: Uint8Array): Promise<{ xml: string; xslt: string; gdtHtml: string }> {
  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(bytes)
    const files = Object.values(zip.files).filter((f) => !f.dir)
    const base = (name: string) => name.replace(/\\/g, '/').split('/').pop() || name
    const xmlFile = files.find((f) => /^invoice\.xml$/i.test(base(f.name)))
      || files.find((f) => f.name.toLowerCase().endsWith('.xml'))
    const xsltFile = files.find((f) => /\.xslt?$/i.test(base(f.name)))
    const htmlFile = files.find((f) => /^invoice\.html$/i.test(base(f.name)))
      || files.find((f) => f.name.toLowerCase().endsWith('.html'))
    return {
      xml: xmlFile ? await xmlFile.async('string') : '',
      xslt: xsltFile ? await xsltFile.async('string') : '',
      gdtHtml: htmlFile ? await htmlFile.async('string') : '',
    }
  } catch {
    return { xml: '', xslt: '', gdtHtml: '' }
  }
}

export function officialGdtHtml(xml: string, xslt: string, gdtHtml: string): string {
  if (gdtHtml.trim()) return sanitizeOfflineHtml(gdtHtml)
  if (xml.trim() && xslt.trim()) {
    const transformed = transformXmlWithXslt(xml, xslt)
    if (transformed) return sanitizeOfflineHtml(transformed)
  }
  return ''
}

export async function loadInvoicePreview(inv: InvoiceRecord): Promise<InvoicePreviewBundle> {
  const [xmlBytes, xsltBytes, htmlBytes] = await Promise.all([
    tryFetchInvoiceBytes(inv.id, 'xml'),
    tryFetchInvoiceBytes(inv.id, 'xslt'),
    tryFetchInvoiceBytes(inv.id, 'html'),
  ])
  const unpacked = looksLikeZipBytes(xmlBytes) && xmlBytes
    ? await unpackInvoiceZip(xmlBytes)
    : { xml: '', xslt: '', gdtHtml: '' }
  const xml = unpacked.xml || invoiceFileText(xmlBytes)
  const xslt = invoiceFileText(xsltBytes) || unpacked.xslt
  const gdtHtml = officialGdtHtml(xml, xslt, invoiceFileText(htmlBytes) || unpacked.gdtHtml)
  let parsed: ParsedInvoice | null = null
  if (xml.trim()) {
    try { parsed = parseEInvoiceXML(xml) } catch { parsed = null }
  }
  return {
    xml,
    xslt,
    gdtHtml,
    printHtml: gdtHtmlForInvoice(inv, xml || undefined),
    parsed,
  }
}

export async function loadInvoiceXmlPreview(inv: InvoiceRecord): Promise<{ xml: string; parsed: ParsedInvoice; html: string }> {
  const p = await loadInvoicePreview(inv)
  if (!p.xml) throw new Error('Chưa có file XML')
  if (!p.parsed) throw new Error('Không đọc được XML')
  return { xml: p.xml, parsed: p.parsed, html: p.printHtml }
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
