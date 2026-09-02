/**
 * 3SU Next — Hoá đơn điện tử (GDT — Tổng cục Thuế) & hoá đơn nhập
 * Port nghiệp vụ từ 25-invoices-gdt.js.
 *
 * Bản gốc lấy hoá đơn mua vào qua tiện ích trình duyệt (bridge) + AI Gemini đọc XML.
 * Ở đây: lớp dữ liệu hoá đơn + cấu trúc GDT typed; việc kéo từ bridge/AI là tuỳ chọn
 * (cần tiện ích + khoá AI), có thể gắn sau qua adapter.
 */
import { dbx } from '../db'
import { localDay, matchesSearch, today, uid } from '../format'
import type { InvoiceRecord } from '../types'
import { makeOp, persistOp, requestFlush } from '../sync/engine'

export const INVOICE_STATUS_LABEL: Record<InvoiceRecord['status'], string> = {
  draft: 'Nháp',
  issued: 'Đã phát hành',
  cancelled: 'Đã hủy',
}

/** Dữ liệu đặc thù hoá đơn GDT (mua vào từ Tổng cục Thuế). */
export interface GdtInvoiceData {
  invoiceId?: string
  nbmst?: string      // mã số thuế người bán
  sellerName?: string // tên người bán
  khmshdon?: string   // ký hiệu mẫu số
  khhdon?: string     // ký hiệu hoá đơn
  shdon?: string      // số hoá đơn
  /** Tổng thanh toán trên hóa đơn (tgtttbso), nếu có */
  total?: number
  hasXml?: boolean
  source?: string
  receiptId?: string
  items?: { name: string; qty: number; price: number }[]
}

export interface InvoiceInput {
  code: string
  type: 'gdt' | 'import'
  amount: number
  tax?: number
  date?: string
  status?: InvoiceRecord['status']
  data?: GdtInvoiceData
  saleId?: string
}

export async function createInvoice(input: InvoiceInput): Promise<InvoiceRecord> {
  const rec: InvoiceRecord = {
    id: uid('inv'),
    code: input.code.trim(),
    type: input.type,
    date: input.date ?? today(),
    amount: Math.round(input.amount),
    tax: Math.round(input.tax ?? 0),
    status: input.status ?? 'draft',
    data: (input.data ?? {}) as Record<string, unknown>,
    ts: Date.now(),
    saleId: input.saleId?.trim() || undefined,
  }
  await dbx.transaction('rw', [dbx.invoices, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('invoice.upsert', null)
    rec.hlc = op.hlc
    await dbx.invoices.put(rec)
    op.payload = rec
    await persistOp(op)
  })
  requestFlush()
  return rec
}

export async function setInvoiceStatus(id: string, status: InvoiceRecord['status']): Promise<void> {
  const inv = await dbx.invoices.get(id)
  if (!inv) return
  inv.status = status
  await dbx.transaction('rw', [dbx.invoices, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('invoice.upsert', null)
    inv.hlc = op.hlc
    await dbx.invoices.put(inv)
    op.payload = inv
    await persistOp(op)
  })
  requestFlush()
}

export async function deleteInvoice(id: string): Promise<void> {
  const inv = await dbx.invoices.get(id)
  if (!inv) return
  await dbx.transaction('rw', [dbx.invoices, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('invoice.delete', { invoiceId: id })
    await dbx.invoices.put({ ...inv, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
    await persistOp(op)
  })
  requestFlush()
}

/** Khoá định danh hoá đơn GDT (port invKey) — ưu tiên invoiceId, fallback bộ số. */
export function gdtInvoiceKey(d: GdtInvoiceData): string {
  return d.invoiceId || `${d.nbmst ?? ''}|${d.khmshdon ?? ''}|${d.khhdon ?? ''}|${d.shdon ?? ''}`
}

export function invoiceExtra(inv: InvoiceRecord): GdtInvoiceData {
  return (inv.data || {}) as GdtInvoiceData
}

/** Chữ để tìm: số HĐ, người bán, MST — giống ô tìm trên máy Invoice. */
export function invoiceSearchText(inv: InvoiceRecord): string {
  const extra = invoiceExtra(inv)
  return [
    inv.code,
    extra.sellerName,
    extra.nbmst,
    extra.khhdon,
    extra.shdon,
    extra.khmshdon,
    inv.date,
  ].filter(Boolean).join(' ')
}

/** Ngày hóa đơn mới trước, rồi số HĐ — không xếp theo lúc máy đẩy lên. */
export function compareInvoiceRows(a: InvoiceRecord, b: InvoiceRecord): number {
  const byDate = String(b.date || '').localeCompare(String(a.date || ''))
  if (byDate) return byDate
  const byCode = String(b.code || '').localeCompare(String(a.code || ''))
  if (byCode) return byCode
  return (b.ts || 0) - (a.ts || 0)
}

export function invoiceXmlState(inv: InvoiceRecord): 'có' | 'chưa' {
  return invoiceExtra(inv).hasXml ? 'có' : 'chưa'
}

/** Số HĐ trên danh sách: ký hiệu · số, giống máy Invoice. */
export function invoiceDisplayCode(inv: InvoiceRecord): string {
  const extra = invoiceExtra(inv)
  const code = String(inv.code || '')
  const split = code.match(/^(.*)-(\d+)$/)
  const series = extra.khhdon || split?.[1] || ''
  const number = extra.shdon || split?.[2] || ''
  if (series && number) return `${series} · ${number}`
  return code || '—'
}

export function invoiceListStatus(inv: InvoiceRecord): { label: string; tone: 'ok' | 'out' | 'low' } {
  if (inv.status === 'cancelled') return { label: 'Đã hủy', tone: 'out' }
  if (invoiceExtra(inv).receiptId) return { label: 'Đã nhập kho', tone: 'ok' }
  if (inv.status === 'draft') return { label: 'Nháp', tone: 'low' }
  return { label: 'Phát hành', tone: 'ok' }
}

export type InvoiceStockFilter = 'all' | 'open' | 'received'
export type InvoiceXmlFilter = 'all' | 'yes' | 'no'
export type InvoiceStatusFilter = 'all' | InvoiceRecord['status']
export type InvoicePeriod = 'all' | 'month' | 'lastMonth' | 'custom'

export interface InvoiceListFilter {
  query: string
  from?: string
  to?: string
  status?: InvoiceStatusFilter
  stock?: InvoiceStockFilter
  xml?: InvoiceXmlFilter
}

export function invoicePeriodRange(
  period: InvoicePeriod,
  from: string,
  to: string,
  now = new Date(),
): { from: string; to: string } {
  if (period === 'custom') return { from, to }
  if (period === 'month') {
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    return { from: start, to: '' }
  }
  if (period === 'lastMonth') {
    const firstThis = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastPrev = new Date(firstThis.getTime() - 1)
    const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1)
    return { from: localDay(firstPrev), to: localDay(lastPrev) }
  }
  return { from: '', to: '' }
}

export function filterInvoiceRows(invoices: InvoiceRecord[], f: InvoiceListFilter): InvoiceRecord[] {
  return invoices
    .filter((i) => {
      if (i.deleted) return false
      if (!matchesSearch(invoiceSearchText(i), f.query)) return false
      const day = String(i.date || '')
      if (f.from && day && day < f.from) return false
      if (f.to && day && day > f.to) return false
      if (f.status && f.status !== 'all' && i.status !== f.status) return false
      const extra = invoiceExtra(i)
      if (f.stock === 'open' && extra.receiptId) return false
      if (f.stock === 'received' && !extra.receiptId) return false
      if (f.xml === 'yes' && !extra.hasXml) return false
      if (f.xml === 'no' && extra.hasXml) return false
      return true
    })
    .sort(compareInvoiceRows)
}

export function visibleInvoiceRows(
  invoices: InvoiceRecord[],
  query: string,
  onlyOpen: boolean,
): InvoiceRecord[] {
  return filterInvoiceRows(invoices, { query, stock: onlyOpen ? 'open' : 'all' })
}

export async function markInvoiceReceipt(invoiceId: string, receiptId: string): Promise<void> {
  const inv = await dbx.invoices.get(invoiceId)
  if (!inv) return
  const next: InvoiceRecord = {
    ...inv,
    data: { ...(inv.data || {}), receiptId },
    ts: Date.now(),
  }
  await dbx.transaction('rw', [dbx.invoices, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('invoice.upsert', null)
    next.hlc = op.hlc
    await dbx.invoices.put(next)
    op.payload = next
    await persistOp(op)
  })
  requestFlush()
}

/** Tổng giá trị hoá đơn gồm thuế. Ưu tiên số tổng trên HĐ nếu máy đã gửi. */
export function invoiceTotal(inv: InvoiceRecord): number {
  const stored = Number(invoiceExtra(inv).total)
  if (Number.isFinite(stored) && stored > 0) return stored
  const amount = Number(inv.amount)
  const tax = Number(inv.tax)
  return (Number.isFinite(amount) ? amount : 0) + (Number.isFinite(tax) ? tax : 0)
}
