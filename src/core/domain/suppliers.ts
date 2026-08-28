/**
 * 3SU Next — Nhà cung cấp & công nợ NCC
 * Port nghiệp vụ từ 50-auth-cloud-ai.js (suppliers) + 26-purchase-orders.js.
 *
 * Công nợ NCC tính DERIVED từ phiếu nhập (goodsReceipts) + khoản đã trả
 * (supplierPayments) để chống trôi dữ liệu — giống bản gốc tính từ stockMoves.
 */
import { dbx } from '../db'
import { uid, today } from '../format'
import type { Supplier, SupplierPayment, GoodsReceipt } from '../types'
import { makeOp, persistOp, requestFlush } from '../sync/engine'
import { assertCloudShopWritable } from '../sync/license'

/* ─── Tính toán công nợ (pure, test được) ─── */

function safeMoney(value: number | undefined): number {
  return Number.isFinite(value) ? Math.round(value ?? 0) : 0
}

/** Tổng giá trị đã nhập từ một NCC (cộng các phiếu nhập). */
export function supplierTotalPurchases(supId: string, receipts: GoodsReceipt[]): number {
  return receipts
    .filter((r) => r.supplierId === supId)
    .reduce((a, r) => a + Math.max(0, safeMoney(r.total)), 0)
}

/** Số phiếu nhập của một NCC. */
export function supplierReceiptCount(supId: string, receipts: GoodsReceipt[]): number {
  return receipts.filter((r) => r.supplierId === supId).length
}

/** Prefix app từng gắn lúc nhập — bỏ qua khi tính extraPaid (dữ liệu cũ). */
export const GR_PAY_NOTE_PREFIX = 'Thanh toán phiếu nhập'

export function isOnReceiptPayment(p: SupplierPayment): boolean {
  if (p.paymentKind === 'receipt') return true
  if (p.paymentKind === 'standalone') return false
  return (p.note || '').startsWith(GR_PAY_NOTE_PREFIX)
}

/**
 * Số dư có dấu: dương = còn nợ NCC, âm = dữ liệu legacy đã trả dư/ứng trước.
 * Command mới không cho trả vượt số dư; giá trị âm chỉ được giữ để đọc dữ liệu cũ.
 */
export function supplierBalance(
  supId: string,
  receipts: GoodsReceipt[],
  payments: SupplierPayment[],
): number {
  const owed = receipts
    .filter((r) => r.supplierId === supId)
    .reduce((sum, receipt) => {
      const total = Math.max(0, safeMoney(receipt.total))
      const paid = Math.max(0, Math.min(total, safeMoney(receipt.paid)))
      return sum + (total - paid)
    }, 0)
  const paid = payments
    .filter((p) => p.supplierId === supId && !isOnReceiptPayment(p))
    .reduce((sum, payment) => sum + Math.max(0, safeMoney(payment.amount)), 0)
  return Math.round(owed - paid)
}

/** Công nợ phải trả, không bao gồm phần ứng trước legacy. */
export function supplierDebt(
  supId: string,
  receipts: GoodsReceipt[],
  payments: SupplierPayment[],
): number {
  return Math.max(0, supplierBalance(supId, receipts, payments))
}

/** Tiền đã trả dư/ứng trước trong dữ liệu legacy. */
export function supplierCredit(
  supId: string,
  receipts: GoodsReceipt[],
  payments: SupplierPayment[],
): number {
  return Math.max(0, -supplierBalance(supId, receipts, payments))
}

export interface SupplierMonthlyStatement {
  purchased: number
  paidOnReceipts: number
  extraPaid: number
  /** Số dư có dấu trong tháng: dương=nợ, âm=dữ liệu legacy trả dư. */
  balance: number
  /** Alias tương thích UI cũ: chỉ phần nợ dương. */
  net: number
  credit: number
  receiptCount: number
}

/** Sao kê một NCC trong tháng YYYY-MM: nhập, trả theo phiếu, trả riêng, nợ/credit tháng. */
export function supplierMonthlyStatement(
  supplierId: string,
  receipts: GoodsReceipt[],
  payments: SupplierPayment[],
  month: string,
): SupplierMonthlyStatement {
  const inMonth = (d: string) => (d || '').slice(0, 7) === month
  const recs = receipts.filter((r) => r.supplierId === supplierId && inMonth(r.date))
  const pays = payments.filter((p) => p.supplierId === supplierId && inMonth(p.date))
  const purchased = recs.reduce((a, r) => a + Math.max(0, safeMoney(r.total)), 0)
  const paidOnReceipts = recs.reduce((a, r) => {
    const total = Math.max(0, safeMoney(r.total))
    return a + Math.max(0, Math.min(total, safeMoney(r.paid)))
  }, 0)
  const extraPaid = pays
    .filter((p) => !isOnReceiptPayment(p))
    .reduce((a, p) => a + Math.max(0, safeMoney(p.amount)), 0)
  const balance = Math.round(purchased - paidOnReceipts - extraPaid)
  return {
    purchased,
    paidOnReceipts,
    extraPaid,
    balance,
    net: Math.max(0, balance),
    credit: Math.max(0, -balance),
    receiptCount: recs.length,
  }
}

export function supplierDebtToAoa(
  suppliers: Supplier[],
  receipts: GoodsReceipt[],
  payments: SupplierPayment[],
): unknown[][] {
  const rows = suppliers
    .filter((s) => !s.deleted)
    .map((s) => ({ name: s.name, phone: s.phone, debt: supplierDebt(s.id, receipts, payments) }))
    .filter((s) => s.debt > 0)
    .sort((a, b) => b.debt - a.debt)
  return [
    ['NCC', 'SĐT', 'Nợ'],
    ...rows.map((s) => [s.name, s.phone, s.debt]),
    [],
    ['Tổng', '', rows.reduce((sum, s) => sum + s.debt, 0)],
  ]
}

export async function exportSupplierDebtXlsx(
  suppliers: Supplier[],
  receipts: GoodsReceipt[],
  payments: SupplierPayment[],
): Promise<void> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(supplierDebtToAoa(suppliers, receipts, payments))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cong no NCC')
  XLSX.writeFile(wb, `3su-cong-no-ncc-${today()}.xlsx`)
}

/** Tổng công nợ tất cả NCC. */
export function totalSupplierDebt(
  suppliers: Supplier[],
  receipts: GoodsReceipt[],
  payments: SupplierPayment[],
): number {
  return suppliers.reduce((a, s) => a + supplierDebt(s.id, receipts, payments), 0)
}

/* ─── CRUD nhà cung cấp ─── */
export interface SupplierInput {
  name: string
  phone?: string
  address?: string
  note?: string
  leadDays?: number
}

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  await assertCloudShopWritable()
  const name = input.name.trim()
  if (!name) throw new Error('Cần tên nhà cung cấp')
  const leadDays = input.leadDays ?? 2
  if (!Number.isFinite(leadDays)) throw new Error('Thời gian giao hàng không hợp lệ')
  const now = Date.now()
  const s: Supplier = {
    id: uid('sup'),
    name,
    phone: (input.phone ?? '').trim(),
    address: (input.address ?? '').trim(),
    note: (input.note ?? '').trim(),
    leadDays: Math.max(0, Math.min(60, leadDays)),
    debt: 0,
    totalPurchased: 0,
    orderCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  await dbx.transaction('rw', [dbx.suppliers, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('supplier.upsert', null)
    s.hlc = op.hlc
    await dbx.suppliers.put(s)
    const { debt: _d, totalPurchased: _tp, orderCount: _oc, ...rest } = s
    op.payload = { supplier: rest }
    await persistOp(op)
  })
  requestFlush()
  return s
}

export async function updateSupplier(id: string, patch: Partial<SupplierInput>): Promise<void> {
  await assertCloudShopWritable()
  const s = await dbx.suppliers.get(id)
  if (!s) return
  const prev = { ...s }
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new Error('Cần tên nhà cung cấp')
    s.name = name
  }
  if (patch.phone !== undefined) s.phone = patch.phone.trim()
  if (patch.address !== undefined) s.address = patch.address.trim()
  if (patch.note !== undefined) s.note = patch.note.trim()
  if (patch.leadDays !== undefined) {
    if (!Number.isFinite(patch.leadDays)) throw new Error('Thời gian giao hàng không hợp lệ')
    s.leadDays = Math.max(0, Math.min(60, patch.leadDays))
  }
  s.updatedAt = Date.now()
  await dbx.transaction('rw', [dbx.suppliers, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('supplier.upsert', null)
    s.hlc = op.hlc
    const omit = new Set(['id', 'debt', 'totalPurchased', 'orderCount', 'fieldHlc', 'hlc', 'deletedHlc'])
    const supplier: Record<string, unknown> = { id }
    const fieldHlc = { ...(prev.fieldHlc ?? {}) }
    for (const key of Object.keys(s) as (keyof Supplier)[]) {
      if (omit.has(key)) continue
      if (!Object.is(s[key], prev[key])) {
        supplier[key] = s[key]
        fieldHlc[key] = op.hlc
      }
    }
    s.fieldHlc = fieldHlc
    await dbx.suppliers.put(s)
    op.payload = { supplier }
    await persistOp(op)
  })
  requestFlush()
}

/** Xóa mềm NCC (không có supplier.delete — dùng upsert + deletedHlc). */
export async function deleteSupplier(id: string): Promise<void> {
  await assertCloudShopWritable()
  const s = await dbx.suppliers.get(id)
  if (!s) return
  const [receipts, payments] = await Promise.all([
    dbx.goodsReceipts.filter((receipt) => receipt.supplierId === id).toArray(),
    dbx.supplierPayments.where('supplierId').equals(id).toArray(),
  ])
  const outstanding = supplierDebt(id, receipts, payments)
  if (outstanding > 0) {
    throw new Error('Nhà cung cấp còn nợ ' + outstanding.toLocaleString('vi-VN') + 'đ')
  }
  await dbx.transaction('rw', [dbx.suppliers, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('supplier.upsert', null)
    s.deleted = true
    s.deletedHlc = op.hlc
    s.hlc = op.hlc
    s.updatedAt = Date.now()
    const fieldHlc = { ...(s.fieldHlc ?? {}) }
    fieldHlc.deleted = op.hlc
    s.fieldHlc = fieldHlc
    await dbx.suppliers.put(s)
    op.payload = { supplier: { id, deleted: true, updatedAt: s.updatedAt } }
    await persistOp(op)
  })
  requestFlush()
}

/* ─── Trả nợ NCC ─── */
export interface SupplierPaymentInput {
  supplierId: string
  amount: number
  note?: string
  date?: string
}

function validIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month! - 1
    && date.getUTCDate() === day
}

/**
 * Ghi khoản trả riêng cho NCC. Command mới không cho vượt số công nợ hiện tại;
 * kiểm tra và ghi payment/outbox diễn ra trong cùng transaction để chống trả đúp.
 */
export async function recordSupplierPayment(input: SupplierPaymentInput): Promise<SupplierPayment> {
  await assertCloudShopWritable()
  if (!input.supplierId) throw new Error('Thiếu nhà cung cấp')
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Cần số tiền hợp lệ')
  const amount = Math.round(input.amount)
  if (amount <= 0) throw new Error('Cần số tiền hợp lệ')
  const date = input.date ?? today()
  if (!validIsoDay(date)) throw new Error('Ngày thanh toán không hợp lệ')
  const note = (input.note ?? '').trim()
  if (note.startsWith(GR_PAY_NOTE_PREFIX)) {
    throw new Error('Ghi chú dùng định dạng dành riêng cho thanh toán phiếu nhập')
  }

  let pay!: SupplierPayment
  await dbx.transaction(
    'rw',
    [dbx.suppliers, dbx.goodsReceipts, dbx.supplierPayments, dbx.syncQueue, dbx.appliedOps],
    async () => {
      const sup = await dbx.suppliers.get(input.supplierId)
      if (!sup || sup.deleted) throw new Error('Không tìm thấy nhà cung cấp')

      const [receipts, payments] = await Promise.all([
        dbx.goodsReceipts.filter((receipt) => receipt.supplierId === input.supplierId).toArray(),
        dbx.supplierPayments.where('supplierId').equals(input.supplierId).toArray(),
      ])
      const outstanding = supplierDebt(input.supplierId, receipts, payments)
      if (outstanding <= 0) throw new Error('Nhà cung cấp không còn công nợ')
      if (amount > outstanding) throw new Error('Số tiền trả vượt công nợ hiện tại')

      pay = {
        id: uid('spay'),
        supplierId: input.supplierId,
        amount,
        date,
        note,
        paymentKind: 'standalone',
      }
      const op = makeOp('supplier.pay', pay)
      await dbx.supplierPayments.add(pay)
      await persistOp(op)
    },
  )
  requestFlush()
  return pay
}

/* ─── So sánh giá giữa các NCC (gợi ý chuyển NCC — bản gốc fetchSupplierInsight) ─── */
export interface SupplierPriceCompare {
  productId: string
  productName: string
  /** NCC đang có giá nhập rẻ nhất */
  bestSupplierId: string
  bestSupplierName: string
  bestCost: number
  /** NCC hiện tại (nhập gần nhất) và giá */
  currentSupplierId: string
  currentSupplierName: string
  currentCost: number
  /** Số tiền tiết kiệm/đơn vị nếu chuyển */
  savingPerUnit: number
}

/**
 * Với mỗi sản phẩm được nhập từ ≥2 NCC, tìm NCC rẻ nhất và gợi ý.
 * Dùng giá vốn trung bình của từng phiếu nhập theo NCC.
 */
export function compareSupplierPrices(
  receipts: GoodsReceipt[],
  suppliers: Supplier[],
): SupplierPriceCompare[] {
  // map: productId -> supplierId -> { costSum, qtySum }
  const byProduct = new Map<string, Map<string, { cost: number; qty: number }>>()
  for (const r of receipts) {
    if (!r.supplierId) continue
    for (const row of r.rows) {
      if (!row.productId || !row.qty) continue
      if (!byProduct.has(row.productId)) byProduct.set(row.productId, new Map())
      const supMap = byProduct.get(row.productId)!
      const cur = supMap.get(r.supplierId) ?? { cost: 0, qty: 0 }
      const base = row.qty * (row.unitRatio || 1)
      if (!Number.isFinite(base) || base <= 0) continue
      cur.cost += row.cost * row.qty
      cur.qty += base
      supMap.set(r.supplierId, cur)
    }
  }
  const supName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? '(NCC)'
  const out: SupplierPriceCompare[] = []
  for (const [productId, supMap] of byProduct) {
    if (supMap.size < 2) continue
    const avg = [...supMap.entries()].map(([supId, v]) => ({
      supId,
      unit: v.qty > 0 ? v.cost / v.qty : 0,
    }))
    avg.sort((a, b) => a.unit - b.unit)
    const best = avg[0]
    const worst = avg[avg.length - 1]
    if (best.supId === worst.supId) continue
    const row0 = receipts.flatMap((r) => r.rows).find((x) => x.productId === productId)
    out.push({
      productId,
      productName: row0?.name ?? '(SP)',
      bestSupplierId: best.supId,
      bestSupplierName: supName(best.supId),
      bestCost: Math.round(best.unit),
      currentSupplierId: worst.supId,
      currentSupplierName: supName(worst.supId),
      currentCost: Math.round(worst.unit),
      savingPerUnit: Math.round(worst.unit - best.unit),
    })
  }
  out.sort((a, b) => b.savingPerUnit - a.savingPerUnit)
  return out
}
