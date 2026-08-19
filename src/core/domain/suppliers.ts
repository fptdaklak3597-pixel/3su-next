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

/* ─── Tính toán công nợ (pure, test được) ─── */

/** Tổng giá trị đã nhập từ một NCC (cộng các phiếu nhập). */
export function supplierTotalPurchases(supId: string, receipts: GoodsReceipt[]): number {
  return receipts
    .filter((r) => r.supplierId === supId)
    .reduce((a, r) => a + (r.total || 0), 0)
}

/** Số phiếu nhập của một NCC. */
export function supplierReceiptCount(supId: string, receipts: GoodsReceipt[]): number {
  return receipts.filter((r) => r.supplierId === supId).length
}

/**
 * Công nợ NCC (≥ 0): tổng (phiếu nhập − đã trả theo phiếu) − các khoản trả riêng.
 * Giống supplierDebt() bản gốc.
 */
/** Prefix app từng gắn lúc nhập — bỏ qua khi tính extraPaid (dữ liệu cũ). */
export const GR_PAY_NOTE_PREFIX = 'Thanh toán phiếu nhập'

export function isOnReceiptPayment(p: SupplierPayment): boolean {
  return (p.note || '').startsWith(GR_PAY_NOTE_PREFIX)
}

export function supplierDebt(
  supId: string,
  receipts: GoodsReceipt[],
  payments: SupplierPayment[],
): number {
  const owed = receipts
    .filter((r) => r.supplierId === supId)
    .reduce((a, r) => a + Math.max(0, (r.total || 0) - (r.paid || 0)), 0)
  const paid = payments
    .filter((p) => p.supplierId === supId && !isOnReceiptPayment(p))
    .reduce((a, p) => a + (p.amount || 0), 0)
  return Math.max(0, Math.round(owed - paid))
}

/** Sao kê một NCC trong tháng YYYY-MM: nhập, trả theo phiếu, trả riêng, còn nợ tháng. */
export function supplierMonthlyStatement(
  supplierId: string,
  receipts: GoodsReceipt[],
  payments: SupplierPayment[],
  month: string,
): { purchased: number; paidOnReceipts: number; extraPaid: number; net: number; receiptCount: number } {
  const inMonth = (d: string) => (d || '').slice(0, 7) === month
  const recs = receipts.filter((r) => r.supplierId === supplierId && inMonth(r.date))
  const pays = payments.filter((p) => p.supplierId === supplierId && inMonth(p.date))
  const purchased = recs.reduce((a, r) => a + (r.total || 0), 0)
  const paidOnReceipts = recs.reduce((a, r) => a + (r.paid || 0), 0)
  const extraPaid = pays.filter((p) => !isOnReceiptPayment(p)).reduce((a, p) => a + (p.amount || 0), 0)
  return {
    purchased,
    paidOnReceipts,
    extraPaid,
    net: Math.max(0, purchased - paidOnReceipts - extraPaid),
    receiptCount: recs.length,
  }
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
  const name = input.name.trim()
  if (!name) throw new Error('Cần tên nhà cung cấp')
  const now = Date.now()
  const s: Supplier = {
    id: uid('sup'),
    name,
    phone: (input.phone ?? '').trim(),
    address: (input.address ?? '').trim(),
    note: (input.note ?? '').trim(),
    leadDays: Math.max(0, Math.min(60, input.leadDays ?? 2)),
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
  if (patch.leadDays !== undefined) s.leadDays = Math.max(0, Math.min(60, patch.leadDays))
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
  const s = await dbx.suppliers.get(id)
  if (!s) return
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

/**
 * Ghi một khoản trả nợ NCC. amount > 0.
 * Trả về bản ghi đã lưu. Ném lỗi nếu số tiền không hợp lệ.
 */
export async function recordSupplierPayment(input: SupplierPaymentInput): Promise<SupplierPayment> {
  const amount = Math.round(input.amount)
  if (!amount || amount <= 0) throw new Error('Cần số tiền hợp lệ')
  const sup = await dbx.suppliers.get(input.supplierId)
  if (!sup) throw new Error('Không tìm thấy nhà cung cấp')
  const pay: SupplierPayment = {
    id: uid('spay'),
    supplierId: input.supplierId,
    amount,
    date: input.date ?? today(),
    note: (input.note ?? '').trim(),
  }
  await dbx.transaction('rw', [dbx.supplierPayments, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('supplier.pay', pay)
    await dbx.supplierPayments.put(pay)
    await persistOp(op)
  })
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
      if (!base) continue
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
