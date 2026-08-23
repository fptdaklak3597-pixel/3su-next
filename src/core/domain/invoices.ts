/**
 * 3SU Next — Hoá đơn điện tử (GDT — Tổng cục Thuế) & hoá đơn nhập
 * Port nghiệp vụ từ 25-invoices-gdt.js.
 *
 * Bản gốc lấy hoá đơn mua vào qua tiện ích trình duyệt (bridge) + AI Gemini đọc XML.
 * Ở đây: lớp dữ liệu hoá đơn + cấu trúc GDT typed; việc kéo từ bridge/AI là tuỳ chọn
 * (cần tiện ích + khoá AI), có thể gắn sau qua adapter.
 */
import { dbx } from '../db'
import { uid, today } from '../format'
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

/** Tổng giá trị hoá đơn gồm thuế. */
export function invoiceTotal(inv: InvoiceRecord): number {
  const amount = Number(inv.amount)
  const tax = Number(inv.tax)
  return (Number.isFinite(amount) ? amount : 0) + (Number.isFinite(tax) ? tax : 0)
}
