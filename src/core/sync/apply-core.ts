/**
 * Reducer op-log v2 — áp op (remote hoặc replay) vào IndexedDB, idempotent.
 * Quy tắc trộn: spec 2026-08-14 mục 3.2-3.4.
 *
 * - Tồn kho/công nợ chỉ đổi qua delta (sale.commit trừ, sale.void hoàn, stock.adjust +-).
 * - Hồ sơ (product/customer/supplier/note/settings/user) qua LWW theo HLC.
 * - Chứng từ (sale/gr/stocktake/debtPayment) immutable append, chống trùng theo id.
 * - Kiểm kê cộng diff (actual − system): không nuốt đơn máy kia đã áp, cũng không nuốt delta local khi localStock = system + pending.
 */
import { dbx, retainLocalPrivilegedVerifier } from '../db'
import { applyStockDeltaToBatches, consumeBatchesFefo, liveBatchExpiry, restoreBatchesFefo } from '../domain/inventory'
import { getThisDeviceId } from '../domain/devices'
import { allocateCustomerDebt, allocationForSale } from '../domain/debt-allocation'
import { compareHlc } from './hlc'
import { observeRemoteHlc } from './engine'
import { isSyncablePasswordHash } from '../domain/auth'
import type {
  SyncOp, Sale, Product, Customer, DebtPayment, StocktakeRecord, Note, Supplier, User,
  StockAdjustPayload, GrCommitPayload, SettingsSetPayload,
  PurchaseOrder, InvoiceRecord, PricingRule, SupplierPayment, PairedDevice,
} from '../types'

const TABLES = () => [dbx.products, dbx.sales, dbx.customers, dbx.debtPayments,
  dbx.goodsReceipts, dbx.stockMoves, dbx.stocktakes, dbx.suppliers, dbx.supplierPayments,
  dbx.purchaseOrders, dbx.invoices, dbx.pricingRules, dbx.batches,
  dbx.priceLog, dbx.notes, dbx.users, dbx.devices, dbx.meta, dbx.appliedOps, dbx.syncQueue]

const POISON_META = 'sync:poisoned'
const BLOCKED_META = 'sync:blocked'
const MAX_DIAGNOSTIC_OPS = 200

export class SyncDependencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncDependencyError'
  }
}

export class SyncPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncPayloadError'
  }
}

export interface PoisonedOp {
  id: string
  type: string
  message: string
  at: number
}

export interface BlockedOp extends PoisonedOp {}

function diagnosticRecord(op: SyncOp, err: unknown): PoisonedOp {
  return {
    id: op.id,
    type: op.type,
    message: err instanceof Error ? err.message : String(err),
    at: Date.now(),
  }
}

async function readDiagnosticOps(key: string): Promise<PoisonedOp[]> {
  const row = await dbx.meta.get(key)
  return Array.isArray(row?.value) ? (row!.value as PoisonedOp[]) : []
}

async function upsertDiagnosticOp(key: string, op: SyncOp, err: unknown): Promise<void> {
  const prev = await readDiagnosticOps(key)
  const next = [...prev.filter((p) => p.id !== op.id), diagnosticRecord(op, err)]
    .slice(-MAX_DIAGNOSTIC_OPS)
  await dbx.meta.put({ key, value: next })
}

async function clearDiagnosticOp(key: string, opId: string): Promise<void> {
  const prev = await readDiagnosticOps(key)
  if (!prev.some((p) => p.id === opId)) return
  await dbx.meta.put({ key, value: prev.filter((p) => p.id !== opId) })
}

/** Op sai payload có tính terminal, đã bỏ qua để cursor tiếp tục. */
export async function getPoisonedOps(): Promise<PoisonedOp[]> {
  return readDiagnosticOps(POISON_META)
}

/** Op hợp lệ nhưng thiếu dependency; chưa được đánh applied và sẽ được thử lại. */
export async function getBlockedOps(): Promise<BlockedOp[]> {
  return readDiagnosticOps(BLOCKED_META)
}

export async function recordPoisonedOp(op: SyncOp, err: unknown): Promise<void> {
  await upsertDiagnosticOp(POISON_META, op, err)
}

export async function recordBlockedOp(op: SyncOp, err: unknown): Promise<void> {
  await upsertDiagnosticOp(BLOCKED_META, op, err)
}

/**
 * Chủ shop bỏ qua op bị kẹt dependency: đánh applied + ghi poison để cursor không đứng mãi.
 * Không áp nghiệp vụ của op.
 */
export async function skipBlockedOp(opId: string): Promise<boolean> {
  const blocked = await getBlockedOps()
  const entry = blocked.find((b) => b.id === opId)
  if (!entry) return false
  if (!(await dbx.appliedOps.get(opId))) await dbx.appliedOps.add({ id: opId })
  const stub = { id: opId, type: entry.type } as SyncOp
  await recordPoisonedOp(stub, new Error('Người dùng bỏ qua op đồng bộ bị kẹt'))
  await clearDiagnosticOp(BLOCKED_META, opId)
  return true
}

async function applyInsideTransaction(op: SyncOp): Promise<void> {
  await dbx.transaction('rw', TABLES(), async () => {
    if (await dbx.appliedOps.get(op.id)) return
    await applyOne(op)
    await dbx.appliedOps.add({ id: op.id })
  })
}

/**
 * Áp một batch theo nhiều lượt để dependency nằm sau trong cùng page vẫn có cơ hội tạo trước.
 * - Dependency chưa có: không đánh applied, ghi blocked, thử lại sau.
 * - Payload hỏng terminal: ghi poison + đánh applied để không khóa toàn bộ shop.
 * - Lỗi IndexedDB/hạ tầng: ném ra ngoài, không đánh applied và không nuốt lỗi.
 */
export async function applyOps(ops: SyncOp[]): Promise<number> {
  let applied = 0
  let pending = [...ops]

  while (pending.length > 0) {
    let progressed = false
    const deferred: Array<{ op: SyncOp; err: SyncDependencyError }> = []

    for (const op of pending) {
      if (await dbx.appliedOps.get(op.id)) {
        await clearDiagnosticOp(BLOCKED_META, op.id)
        observeRemoteHlc(op.hlc)
        progressed = true
        continue
      }

      try {
        await applyInsideTransaction(op)
        await clearDiagnosticOp(BLOCKED_META, op.id)
        observeRemoteHlc(op.hlc)
        applied += 1
        progressed = true
      } catch (err) {
        if (err instanceof SyncDependencyError) {
          await recordBlockedOp(op, err)
          observeRemoteHlc(op.hlc)
          deferred.push({ op, err })
          continue
        }
        if (err instanceof SyncPayloadError) {
          if (!(await dbx.appliedOps.get(op.id))) await dbx.appliedOps.add({ id: op.id })
          await recordPoisonedOp(op, err)
          await clearDiagnosticOp(BLOCKED_META, op.id)
          observeRemoteHlc(op.hlc)
          progressed = true
          continue
        }
        throw err
      }
    }

    if (deferred.length === 0) break
    if (!progressed) {
      const first = deferred[0]
      throw new SyncDependencyError(
        `Đồng bộ đang chờ dependency cho ${first.op.type} (${first.op.id}): ${first.err.message}`,
      )
    }
    pending = deferred.map((d) => d.op)
  }

  return applied
}

/**
 * Giữ ID lịch sử cho lần xuất hiện đầu tiên của mỗi sản phẩm.
 * Chỉ thêm hậu tố khi cùng productId lặp trong một chứng từ.
 */
function nextDocumentMoveId(
  opId: string,
  productId: string,
  occurrences: Map<string, number>,
): string {
  const occurrence = occurrences.get(productId) ?? 0
  occurrences.set(productId, occurrence + 1)
  const legacy = `mv_${opId}_${productId}`
  return occurrence === 0 ? legacy : `${legacy}_${occurrence}`
}

function payloadError(message: string): never {
  throw new SyncPayloadError(message)
}

function dependencyError(message: string): never {
  throw new SyncDependencyError(message)
}

/**
 * Tin dòng hàng (qty/price/cost), không tin tổng tiền từ payload.
 * Công thức khớp confirmSale local — mọi thiết bị hội tụ cùng số.
 */
function recomputeSaleMoney(sale: Sale): Sale {
  for (const it of sale.items) {
    if (!Number.isFinite(it.price) || it.price < 0 || !Number.isFinite(it.cost) || it.cost < 0) {
      payloadError('sale.commit có giá/giá vốn không hợp lệ')
    }
  }
  const subtotal = sale.items.reduce((a, it) => a + it.price * it.qty, 0)
  if (!Number.isFinite(subtotal) || subtotal < 0) payloadError('sale.commit tạm tính không hợp lệ')
  const rawDiscount = Number.isFinite(sale.discount) ? Math.round(sale.discount) : 0
  const discount = Math.max(0, Math.min(rawDiscount, subtotal))
  const total = Math.max(0, subtotal - discount)
  const profit = sale.items.reduce((a, it) => a + (it.price - it.cost) * it.qty, 0) - discount
  if (!Number.isFinite(profit)) payloadError('sale.commit lợi nhuận không hợp lệ')

  const payMethod = sale.payMethod === 'transfer' || sale.payMethod === 'debt' ? sale.payMethod : 'cash'
  const isDebt = payMethod === 'debt'
  const cashTendered = Number.isFinite(sale.tendered) ? Math.max(0, Math.round(sale.tendered)) : 0
  const tendered = isDebt ? 0 : (payMethod === 'cash' ? cashTendered : total)
  const change = isDebt ? 0 : Math.max(0, tendered - total)
  const debtAmount = isDebt ? total : (payMethod === 'cash' ? Math.max(0, total - tendered) : 0)
  if (debtAmount > 0 && !sale.customerId) {
    payloadError('sale.commit ghi nợ cần khách hàng')
  }

  return {
    ...sale,
    discount,
    total,
    profit,
    payMethod,
    tendered,
    change,
    debtAmount,
  }
}

/** Tổng phiếu nhập từ dòng hàng — bỏ qua gr.total / purchasedDelta từ client. */
function recomputeGoodsReceiptTotal(gr: NonNullable<GrCommitPayload['gr']>): number {
  const rows = Array.isArray(gr.rows) ? gr.rows : []
  let sum = 0
  for (const row of rows) {
    if (!Number.isFinite(row.qty) || row.qty < 0 || !Number.isFinite(row.cost) || row.cost < 0) {
      payloadError('gr.commit có dòng không hợp lệ')
    }
    sum += row.qty * row.cost
  }
  return Math.round(sum)
}

async function applyOne(op: SyncOp): Promise<void> {
  switch (op.type) {
    case 'sale.commit': {
      const raw = op.payload as Sale | null
      if (!raw?.id || !Array.isArray(raw.items) || raw.items.length === 0) {
        payloadError('sale.commit thiếu id hoặc dòng hàng')
      }
      for (const it of raw.items) {
        if (!it?.productId || !Number.isFinite(it.qty) || !Number.isFinite(it.unitRatio) || it.qty <= 0 || it.unitRatio <= 0) {
          payloadError('sale.commit có dòng hàng không hợp lệ')
        }
        const p = await dbx.products.get(it.productId)
        if (!p) dependencyError('sale.commit thiếu SP ' + it.productId)
      }
      const sale = recomputeSaleMoney(raw)
      if (sale.customerId) {
        const c = await dbx.customers.get(sale.customerId)
        if (!c) dependencyError('sale.commit thiếu khách ' + sale.customerId)
      }
      if (await dbx.sales.get(sale.id)) return
      await dbx.sales.add(sale)
      const moveOccurrences = new Map<string, number>()
      for (const it of sale.items) {
        const p = await dbx.products.get(it.productId)
        if (!p) dependencyError('sale.commit thiếu SP ' + it.productId)
        const deducted = it.qty * it.unitRatio
        const skipStock = !!(p.stockSetHlc && compareHlc(op.hlc, p.stockSetHlc) <= 0)
        if (!skipStock) {
          p.stock -= deducted
          p.updatedAt = Date.now()
          if (p.batches?.length) {
            p.batches = consumeBatchesFefo(p.batches, deducted).batches
            p.expiry = liveBatchExpiry(p.batches)
            for (const b of p.batches) await dbx.batches.put(b)
          }
          await dbx.products.put(p)
          await dbx.stockMoves.add({
            id: nextDocumentMoveId(op.id, it.productId, moveOccurrences),
            productId: it.productId,
            type: 'sale',
            qty: -deducted,
            cost: it.cost,
            note: 'Bán: ' + it.name,
            refId: sale.id,
            date: sale.date,
            ts: Date.now(),
          })
        }
      }
      if (sale.customerId) {
        const c = await dbx.customers.get(sale.customerId)
        if (!c) dependencyError('sale.commit thiếu khách ' + sale.customerId)
        c.debt += sale.debtAmount || 0
        c.totalSpent += sale.total
        c.orderCount += 1
        c.updatedAt = Date.now()
        await dbx.customers.put(c)
      }
      return
    }
    case 'sale.void': {
      const payload = op.payload as { saleId?: string; reason?: string } | null
      if (!payload?.saleId) payloadError('sale.void thiếu saleId')
      const sale = await dbx.sales.get(payload.saleId)
      if (!sale) dependencyError('sale.void chưa có đơn ' + payload.saleId)
      if (sale.voided) return
      for (const it of sale.items) {
        if (!(await dbx.products.get(it.productId))) dependencyError('sale.void thiếu SP ' + it.productId)
      }

      sale.voided = true
      sale.voidedAt = new Date().toISOString()
      sale.voidReason = payload.reason ?? ''
      await dbx.sales.put(sale)

      const moveOccurrences = new Map<string, number>()
      for (const it of sale.items) {
        const p = await dbx.products.get(it.productId)
        if (!p) dependencyError('sale.void thiếu SP ' + it.productId)
        const add = it.qty * it.unitRatio
        const skipStock = !!(p.stockSetHlc && compareHlc(op.hlc, p.stockSetHlc) <= 0)
        if (!skipStock) {
          p.stock += add
          p.updatedAt = Date.now()
          if (p.batches?.length) {
            p.batches = restoreBatchesFefo(p.batches, add)
            p.expiry = liveBatchExpiry(p.batches)
            for (const b of p.batches) await dbx.batches.put(b)
          }
          await dbx.products.put(p)
          await dbx.stockMoves.add({
            id: nextDocumentMoveId(op.id, it.productId, moveOccurrences),
            productId: it.productId,
            type: 'void_restore',
            qty: add,
            cost: it.cost,
            note: 'Hoàn kho do hủy đơn',
            refId: sale.id,
            date: new Date().toISOString(),
            ts: Date.now(),
          })
        }
      }

      if (sale.customerId) {
        const c = await dbx.customers.get(sale.customerId)
        if (c) {
          if (sale.debtAmount > 0) {
            const openSales = await dbx.sales
              .filter((s) => s.customerId === sale.customerId)
              .toArray()
            const forAlloc = openSales.map((s) => s.id === sale.id ? { ...s, voided: false } : s)
            const pays = await dbx.debtPayments.where('customerId').equals(sale.customerId).toArray()
            const slice = allocationForSale(allocateCustomerDebt(forAlloc, pays, sale.customerId), sale.id)
            c.debt = Math.max(0, c.debt - slice.unpaid)
            if (slice.allocated > 0) {
              const dpId = `dp_void_${op.id}`
              if (!(await dbx.debtPayments.get(dpId))) {
                await dbx.debtPayments.add({
                  id: dpId,
                  customerId: sale.customerId,
                  amount: -slice.allocated,
                  date: new Date().toISOString(),
                  note: 'Hoàn tiền do hủy đơn ' + sale.id.slice(-6),
                })
              }
            }
          }
          c.totalSpent = Math.max(0, c.totalSpent - sale.total)
          c.orderCount = Math.max(0, c.orderCount - 1)
          c.updatedAt = Date.now()
          await dbx.customers.put(c)
        }
      }
      return
    }
    case 'product.upsert': {
      const payload = op.payload as { product?: Partial<Product> & { id?: string } } | null
      const product = payload?.product
      if (!product?.id) payloadError('product.upsert thiếu product.id')
      const cur = await dbx.products.get(product.id)
      if (cur) {
        if (cur.deletedHlc && compareHlc(op.hlc, cur.deletedHlc) <= 0) return
        const next: Product = { ...cur, fieldHlc: { ...(cur.fieldHlc ?? {}) } }
        const skip = new Set(['stock', 'batches', 'stockSetHlc', 'grHlc', 'id', 'fieldHlc', 'hlc', 'deletedHlc'])
        for (const key of Object.keys(product) as (keyof Product)[]) {
          if (skip.has(key)) continue
          const prevHlc = next.fieldHlc?.[key]
          if (prevHlc && compareHlc(op.hlc, prevHlc) <= 0) continue
          ;(next as unknown as Record<string, unknown>)[key] = product[key]
          next.fieldHlc![key] = op.hlc
        }
        if (product.deleted === true && (!next.deletedHlc || compareHlc(op.hlc, next.deletedHlc) > 0)) {
          next.deletedHlc = op.hlc
        }
        if (!cur.hlc || compareHlc(op.hlc, cur.hlc) > 0) next.hlc = op.hlc
        next.stock = cur.stock
        next.batches = cur.batches
        await dbx.products.put(next)
      } else {
        await dbx.products.put({ ...(product as Product), stock: 0, batches: [], hlc: op.hlc })
      }
      return
    }
    case 'stock.adjust': {
      const pl = op.payload as Partial<StockAdjustPayload> | null
      if (!pl?.productId || !Number.isFinite(pl.delta)) payloadError('stock.adjust thiếu productId hoặc delta')
      const mvId = 'mv_' + op.id
      if (await dbx.stockMoves.get(mvId)) return
      const p = await dbx.products.get(pl.productId)
      if (!p) dependencyError('stock.adjust thiếu SP ' + pl.productId)
      p.stock += pl.delta as number
      p.updatedAt = Date.now()
      await dbx.products.put(p)
      await dbx.stockMoves.add({
        id: mvId,
        productId: pl.productId,
        type: 'adjust',
        qty: pl.delta as number,
        cost: p.cost,
        note: pl.reason ?? '',
        refId: pl.refId ?? '',
        date: new Date().toISOString(),
        ts: Date.now(),
      })
      return
    }
    case 'stocktake.commit': {
      const rec = op.payload as StocktakeRecord | null
      if (!rec?.id || !Array.isArray(rec.rows)) payloadError('stocktake.commit thiếu id hoặc rows')
      if (!(await dbx.stocktakes.get(rec.id))) await dbx.stocktakes.add(rec)
      const moveOccurrences = new Map<string, number>()
      for (const row of rec.rows) {
        if (!row?.productId) payloadError('stocktake.commit có dòng thiếu productId')
        const diff = typeof row.diff === 'number' ? row.diff : row.actual - row.system
        if (!Number.isFinite(diff)) payloadError('stocktake.commit có diff không hợp lệ')
        const p = await dbx.products.get(row.productId)
        if (!p) dependencyError('stocktake thiếu SP ' + row.productId)
        if (p.stockSetHlc && compareHlc(op.hlc, p.stockSetHlc) <= 0) continue
        if (diff === 0) {
          p.stockSetHlc = op.hlc
          p.updatedAt = Date.now()
          await dbx.products.put(p)
          continue
        }
        const mvId = nextDocumentMoveId(op.id, row.productId, moveOccurrences)
        if (await dbx.stockMoves.get(mvId)) continue
        p.stock += diff
        await applyStockDeltaToBatches(p, diff)
        p.stockSetHlc = op.hlc
        p.updatedAt = Date.now()
        await dbx.products.put(p)
        await dbx.stockMoves.add({
          id: mvId,
          productId: row.productId,
          type: 'stocktake',
          qty: diff,
          cost: p.cost,
          note: 'Kiểm kê: ' + (diff > 0 ? 'thừa' : 'thiếu') + ' ' + Math.abs(diff),
          refId: rec.id,
          date: rec.date,
          ts: rec.ts,
        })
      }
      return
    }
    case 'debt.pay': {
      const dp = op.payload as DebtPayment | null
      if (!dp?.id || !dp.customerId || !Number.isFinite(dp.amount)) {
        payloadError('debt.pay thiếu dữ liệu hợp lệ')
      }
      const amount = Math.round(dp.amount)
      if (amount === 0) payloadError('debt.pay thiếu dữ liệu hợp lệ')
      if (await dbx.debtPayments.get(dp.id)) return
      const c = await dbx.customers.get(dp.customerId)
      if (!c) dependencyError('debt.pay thiếu khách ' + dp.customerId)
      const rounded: DebtPayment = { ...dp, amount }
      await dbx.debtPayments.add(rounded)
      // amount > 0: thu nợ; amount < 0: phiếu hoàn (không đổi số dư — đã xử lý lúc void)
      if (amount > 0) c.debt = Math.max(0, c.debt - amount)
      c.updatedAt = Date.now()
      await dbx.customers.put(c)
      return
    }
    case 'gr.commit': {
      const payload = op.payload as Partial<GrCommitPayload> | null
      const grRaw = payload?.gr
      const patches = payload?.patches
      const supplierDelta = payload?.supplierDelta
      if (!grRaw?.id || !Array.isArray(patches)) payloadError('gr.commit thiếu phiếu hoặc patches')
      if (await dbx.goodsReceipts.get(grRaw.id)) return
      for (const pt of patches) {
        if (!pt?.productId || !Number.isFinite(pt.addQty)) payloadError('gr.commit có patch không hợp lệ')
        if (!(await dbx.products.get(pt.productId))) dependencyError('gr.commit thiếu SP ' + pt.productId)
      }
      const expectedTotal = recomputeGoodsReceiptTotal(grRaw)
      const gr = { ...grRaw, total: expectedTotal }
      await dbx.goodsReceipts.add(gr)
      const moveOccurrences = new Map<string, number>()
      for (const pt of patches) {
        const p = await dbx.products.get(pt.productId)
        if (!p) dependencyError('gr.commit thiếu SP ' + pt.productId)
        p.stock += pt.addQty
        if (!p.grHlc || compareHlc(op.hlc, p.grHlc) > 0) {
          p.cost = pt.newCost
          if (pt.newPrice) p.price = pt.newPrice
          if (pt.expiry) p.expiry = pt.expiry
          p.grHlc = op.hlc
        }
        for (const b of pt.batches ?? []) {
          if (!(await dbx.batches.get(b.id))) {
            await dbx.batches.add(b)
            p.batches = [...(p.batches || []), b]
          }
        }
        p.updatedAt = Date.now()
        await dbx.products.put(p)
        for (const pl of pt.priceLogRows ?? []) {
          if (!(await dbx.priceLog.get(pl.id))) await dbx.priceLog.add(pl)
        }
        await dbx.stockMoves.add({
          id: nextDocumentMoveId(op.id, pt.productId, moveOccurrences),
          productId: pt.productId,
          type: 'purchase',
          qty: pt.addQty,
          cost: pt.newCost,
          note: 'Nhập: ' + gr.code,
          refId: gr.id,
          date: gr.date,
          ts: Date.now(),
        })
      }
      if (supplierDelta) {
        if (!supplierDelta.supplierId) payloadError('gr.commit supplierDelta thiếu supplierId')
        const sup = await dbx.suppliers.get(supplierDelta.supplierId)
        if (sup) {
          const debtDelta = Number.isFinite(supplierDelta.debtDelta) ? supplierDelta.debtDelta : 0
          // purchasedDelta tin từ Σ dòng hàng, không tin client
          sup.debt += debtDelta
          sup.totalPurchased += expectedTotal
          sup.orderCount += 1
          sup.updatedAt = Date.now()
          await dbx.suppliers.put(sup)
        }
      }
      return
    }
    case 'settings.set': {
      const payload = op.payload as Partial<SettingsSetPayload> | null
      if ((payload?.key !== 'settings' && payload?.key !== 'shop') || !('value' in (payload ?? {}))) {
        payloadError('settings.set thiếu key/value hợp lệ')
      }
      const hlcKey = 'hlc:' + payload.key
      const cur = await dbx.meta.get(hlcKey)
      if (cur && compareHlc(op.hlc, cur.value as string) <= 0) return
      await dbx.meta.put({ key: payload.key, value: payload.value })
      await dbx.meta.put({ key: hlcKey, value: op.hlc })
      return
    }
    case 'customer.upsert': {
      const payload = op.payload as { customer?: Partial<Customer> & { id?: string } } | null
      const customer = payload?.customer
      if (!customer?.id) payloadError('customer.upsert thiếu customer.id')
      const cur = await dbx.customers.get(customer.id)
      if (cur) {
        if (cur.deletedHlc && compareHlc(op.hlc, cur.deletedHlc) <= 0) return
        const next: Customer = { ...cur, fieldHlc: { ...(cur.fieldHlc ?? {}) } }
        const skip = new Set(['id', 'debt', 'totalSpent', 'orderCount', 'fieldHlc', 'hlc', 'deletedHlc'])
        for (const key of Object.keys(customer) as (keyof Customer)[]) {
          if (skip.has(key)) continue
          const prevHlc = next.fieldHlc?.[key]
          if (prevHlc && compareHlc(op.hlc, prevHlc) <= 0) continue
          ;(next as unknown as Record<string, unknown>)[key] = customer[key]
          next.fieldHlc![key] = op.hlc
        }
        if (customer.deleted === true && (!next.deletedHlc || compareHlc(op.hlc, next.deletedHlc) > 0)) {
          next.deletedHlc = op.hlc
        }
        if (!cur.hlc || compareHlc(op.hlc, cur.hlc) > 0) next.hlc = op.hlc
        next.debt = cur.debt
        next.totalSpent = cur.totalSpent
        next.orderCount = cur.orderCount
        await dbx.customers.put(next)
      } else {
        await dbx.customers.put({ ...(customer as Customer), debt: 0, totalSpent: 0, orderCount: 0, hlc: op.hlc })
      }
      return
    }
    case 'customer.delete': {
      const payload = op.payload as { customerId?: string } | null
      if (!payload?.customerId) payloadError('customer.delete thiếu customerId')
      const cur = await dbx.customers.get(payload.customerId)
      if (cur && (!cur.deletedHlc || compareHlc(op.hlc, cur.deletedHlc) > 0)) {
        await dbx.customers.put({ ...cur, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
      }
      return
    }
    case 'product.delete': {
      const payload = op.payload as { productId?: string } | null
      if (!payload?.productId) payloadError('product.delete thiếu productId')
      const cur = await dbx.products.get(payload.productId)
      if (cur && (!cur.deletedHlc || compareHlc(op.hlc, cur.deletedHlc) > 0)) {
        await dbx.products.put({ ...cur, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
      }
      return
    }
    case 'supplier.upsert': {
      const payload = op.payload as { supplier?: Partial<Supplier> & { id?: string } } | null
      const supplier = payload?.supplier
      if (!supplier?.id) payloadError('supplier.upsert thiếu supplier.id')
      const cur = await dbx.suppliers.get(supplier.id)
      if (cur) {
        if (cur.deletedHlc && compareHlc(op.hlc, cur.deletedHlc) <= 0) return
        const next: Supplier = { ...cur, fieldHlc: { ...(cur.fieldHlc ?? {}) } }
        const skip = new Set(['id', 'debt', 'totalPurchased', 'orderCount', 'fieldHlc', 'hlc', 'deletedHlc'])
        for (const key of Object.keys(supplier) as (keyof Supplier)[]) {
          if (skip.has(key)) continue
          const prevHlc = next.fieldHlc?.[key]
          if (prevHlc && compareHlc(op.hlc, prevHlc) <= 0) continue
          ;(next as unknown as Record<string, unknown>)[key] = supplier[key]
          next.fieldHlc![key] = op.hlc
        }
        if (supplier.deleted === true && (!next.deletedHlc || compareHlc(op.hlc, next.deletedHlc) > 0)) {
          next.deletedHlc = op.hlc
        }
        if (!cur.hlc || compareHlc(op.hlc, cur.hlc) > 0) next.hlc = op.hlc
        next.debt = cur.debt
        next.totalPurchased = cur.totalPurchased
        next.orderCount = cur.orderCount
        await dbx.suppliers.put(next)
      } else {
        await dbx.suppliers.put({ ...(supplier as Supplier), debt: 0, totalPurchased: 0, orderCount: 0, hlc: op.hlc })
      }
      return
    }
    case 'supplier.pay': {
      const pay = op.payload as SupplierPayment | null
      if (!pay?.id || !pay.supplierId || !Number.isFinite(pay.amount) || pay.amount <= 0) {
        payloadError('supplier.pay thiếu dữ liệu')
      }
      if (await dbx.supplierPayments.get(pay.id)) return
      await dbx.supplierPayments.add(pay)
      return
    }
    case 'po.upsert': {
      const po = op.payload as PurchaseOrder | null
      if (!po?.id) payloadError('po.upsert thiếu id')
      const cur = await dbx.purchaseOrders.get(po.id)
      if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      await dbx.purchaseOrders.put({ ...po, hlc: op.hlc })
      return
    }
    case 'invoice.upsert': {
      const inv = op.payload as InvoiceRecord | null
      if (!inv?.id) payloadError('invoice.upsert thiếu id')
      const cur = await dbx.invoices.get(inv.id)
      if (cur?.deletedHlc && compareHlc(op.hlc, cur.deletedHlc) <= 0) return
      if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      await dbx.invoices.put({
        ...cur,
        ...inv,
        deleted: inv.deleted ?? cur?.deleted,
        deletedHlc: cur?.deletedHlc,
        hlc: op.hlc,
      })
      return
    }
    case 'invoice.delete': {
      const payload = op.payload as { invoiceId?: string } | null
      if (!payload?.invoiceId) payloadError('invoice.delete thiếu invoiceId')
      const cur = await dbx.invoices.get(payload.invoiceId)
      if (cur) {
        if (!cur.deletedHlc || compareHlc(op.hlc, cur.deletedHlc) > 0) {
          await dbx.invoices.put({ ...cur, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
        }
      } else {
        await dbx.invoices.put({
          id: payload.invoiceId,
          code: '',
          type: 'import',
          date: '',
          amount: 0,
          tax: 0,
          status: 'draft',
          data: {},
          ts: 0,
          deleted: true,
          deletedHlc: op.hlc,
          hlc: op.hlc,
        })
      }
      return
    }
    case 'pricing.upsert': {
      const rule = op.payload as PricingRule | null
      if (!rule?.id) payloadError('pricing.upsert thiếu id')
      const cur = await dbx.pricingRules.get(rule.id)
      if (cur?.deletedHlc && compareHlc(op.hlc, cur.deletedHlc) <= 0) return
      if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      await dbx.pricingRules.put({
        ...cur,
        ...rule,
        deleted: rule.deleted ?? cur?.deleted,
        deletedHlc: cur?.deletedHlc,
        hlc: op.hlc,
      })
      return
    }
    case 'pricing.delete': {
      const payload = op.payload as { ruleId?: string } | null
      if (!payload?.ruleId) payloadError('pricing.delete thiếu ruleId')
      const cur = await dbx.pricingRules.get(payload.ruleId)
      if (cur) {
        if (!cur.deletedHlc || compareHlc(op.hlc, cur.deletedHlc) > 0) {
          await dbx.pricingRules.put({ ...cur, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
        }
      } else {
        await dbx.pricingRules.put({
          id: payload.ruleId,
          name: '',
          cat: '',
          marginPct: 0,
          roundTo: 0,
          active: false,
          deleted: true,
          deletedHlc: op.hlc,
          hlc: op.hlc,
        })
      }
      return
    }
    case 'note.upsert': {
      const note = op.payload as Note | null
      if (!note?.id) payloadError('note.upsert thiếu id')
      const cur = await dbx.notes.get(note.id)
      if (cur?.deletedHlc && compareHlc(op.hlc, cur.deletedHlc) <= 0) return
      if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      await dbx.notes.put({
        ...cur,
        ...note,
        deleted: note.deleted ?? cur?.deleted,
        deletedHlc: cur?.deletedHlc,
        hlc: op.hlc,
      })
      return
    }
    case 'note.delete': {
      const payload = op.payload as { noteId?: string } | null
      if (!payload?.noteId) payloadError('note.delete thiếu noteId')
      const cur = await dbx.notes.get(payload.noteId)
      if (cur) {
        if (!cur.deletedHlc || compareHlc(op.hlc, cur.deletedHlc) > 0) {
          await dbx.notes.put({ ...cur, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
        }
      } else {
        await dbx.notes.put({
          id: payload.noteId,
          text: '',
          date: '',
          type: 'note',
          done: false,
          pinned: false,
          deleted: true,
          deletedHlc: op.hlc,
          hlc: op.hlc,
        })
      }
      return
    }
    case 'user.upsert': {
      const payload = op.payload as { user?: User } | null
      let user = payload?.user
      if (!user?.id) payloadError('user.upsert thiếu id')
      // Hash rỗng = redacted OK; hash legacy/malformed → bỏ verifier, vẫn áp profile.
      if (user.passwordHash || user.salt) {
        if (!isSyncablePasswordHash(String(user.passwordHash ?? ''), String(user.salt ?? ''))) {
          user = { ...user, passwordHash: '', salt: '', passwordNeedsReset: true }
        }
      }
      const cur = await dbx.users.get(user.id)
      if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      await dbx.users.put(retainLocalPrivilegedVerifier({ ...user, hlc: op.hlc }, cur))
      return
    }
    case 'user.password': {
      const p = op.payload as {
        userId?: string
        passwordHash?: string
        salt?: string
        passwordNeedsReset?: boolean
        updatedAt?: number
      } | null
      if (!p?.userId || !p.passwordHash || !p.salt) payloadError('user.password thiếu dữ liệu')
      if (!isSyncablePasswordHash(p.passwordHash, p.salt)) {
        payloadError('user.password hash không đạt chuẩn sync')
      }
      const cur = await dbx.users.get(p.userId)
      if (!cur) dependencyError('user.password thiếu user ' + p.userId)
      if (cur.role === 'owner' || cur.role === 'admin') {
        payloadError('user.password hash không được áp cho owner/admin')
      }
      if (cur.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      await dbx.users.put({
        ...cur,
        passwordHash: p.passwordHash,
        salt: p.salt,
        passwordNeedsReset: p.passwordNeedsReset ?? false,
        updatedAt: p.updatedAt ?? Date.now(),
        hlc: op.hlc,
      })
      return
    }
    case 'user.delete': {
      const payload = op.payload as { userId?: string } | null
      if (!payload?.userId) payloadError('user.delete thiếu userId')
      const cur = await dbx.users.get(payload.userId)
      if (cur && (!cur.hlc || compareHlc(op.hlc, cur.hlc) > 0)) {
        await dbx.users.put({ ...cur, deleted: true, active: false, hlc: op.hlc })
      }
      return
    }
    case 'device.upsert': {
      const payload = op.payload as { device?: PairedDevice } | null
      const device = payload?.device
      if (!device?.deviceId) payloadError('device.upsert thiếu deviceId')
      const thisId = await getThisDeviceId()
      await dbx.devices.put({ ...device, isThis: device.deviceId === thisId })
      return
    }
    case 'device.remove': {
      const payload = op.payload as { deviceId?: string } | null
      if (!payload?.deviceId) payloadError('device.remove thiếu deviceId')
      const thisId = await getThisDeviceId()
      if (payload.deviceId === thisId) return
      const existing = await dbx.devices.where('deviceId').equals(payload.deviceId).first()
      if (existing) await dbx.devices.delete(existing.id)
      return
    }
    default:
      payloadError('Loại op không được hỗ trợ: ' + String((op as { type?: unknown }).type))
  }
}
