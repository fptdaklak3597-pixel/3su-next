/**
 * Reducer op-log v2 — áp op (remote hoặc replay) vào IndexedDB, idempotent.
 * Quy tắc trộn: spec 2026-08-14 mục 3.2-3.4.
 *
 * - Tồn kho/công nợ chỉ đổi qua delta (sale.commit trừ, sale.void hoàn, stock.adjust +-).
 * - Hồ sơ (product/customer/supplier/note/settings/user) qua LWW theo HLC.
 * - Chứng từ (sale/gr/stocktake/debtPayment) immutable append, chống trùng theo id.
 * - Kiểm kê cộng diff (actual − system): không nuốt đơn máy kia đã áp, cũng không nuốt delta local khi localStock = system + pending.
 */
import { dbx } from '../db'
import { applyStockDeltaToBatches, consumeBatchesFefo, liveBatchExpiry, restoreBatchesFefo } from '../domain/inventory'
import { getThisDeviceId } from '../domain/devices'
import { compareHlc } from './hlc'
import { observeRemoteHlc } from './engine'
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

export interface PoisonedOp {
  id: string
  type: string
  message: string
  at: number
}

/** Danh sách op độc đã ghi vào meta (không retry). */
export async function getPoisonedOps(): Promise<PoisonedOp[]> {
  const row = await dbx.meta.get(POISON_META)
  return Array.isArray(row?.value) ? (row!.value as PoisonedOp[]) : []
}

/** Ghi op lỗi vào meta quarantine — thay thế bản cũ cùng op.id. */
export async function recordPoisonedOp(op: SyncOp, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err)
  const prev = await getPoisonedOps()
  const next = [...prev.filter((p) => p.id !== op.id), {
    id: op.id, type: op.type, message, at: Date.now(),
  }]
  await dbx.meta.put({ key: POISON_META, value: next })
}

export async function applyOps(ops: SyncOp[]): Promise<number> {
  let applied = 0
  for (const op of ops) {
    if (await dbx.appliedOps.get(op.id)) {
      observeRemoteHlc(op.hlc)
      continue
    }
    try {
      await dbx.transaction('rw', TABLES(), async () => {
        if (await dbx.appliedOps.get(op.id)) return
        await applyOne(op)
        await dbx.appliedOps.add({ id: op.id })
      })
      observeRemoteHlc(op.hlc)
      applied += 1
    } catch (err) {
      // Op độc: rollback tx, đánh appliedOps để không kẹt pull, ghi poison, tiếp op sau
      if (!(await dbx.appliedOps.get(op.id))) await dbx.appliedOps.add({ id: op.id })
      await recordPoisonedOp(op, err)
      observeRemoteHlc(op.hlc)
    }
  }
  return applied
}

/** Tổng delta tồn của các op CÒN TRONG OUTBOX local cho 1 SP (quy tắc delta treo). */
export async function pendingStockDelta(productId: string): Promise<number> {
  const pending = await dbx.syncQueue.toArray()
  let d = 0
  for (const op of pending) {
    if (op.type === 'sale.commit') {
      const s = op.payload as Sale
      for (const it of s.items) if (it.productId === productId) d -= it.qty * it.unitRatio
    } else if (op.type === 'sale.void') {
      const { saleId } = op.payload as { saleId: string }
      const s = await dbx.sales.get(saleId)
      if (s) for (const it of s.items) if (it.productId === productId) d += it.qty * it.unitRatio
    } else if (op.type === 'stock.adjust') {
      const p = op.payload as StockAdjustPayload
      if (p.productId === productId) d += p.delta
    } else if (op.type === 'gr.commit') {
      const g = op.payload as GrCommitPayload
      for (const pt of g.patches) if (pt.productId === productId) d += pt.addQty
    }
  }
  return d
}

async function applyOne(op: SyncOp): Promise<void> {
  switch (op.type) {
    case 'sale.commit': {
      const sale = op.payload as Sale
      if (await dbx.sales.get(sale.id)) return
      if (!sale.items?.length) throw new Error('sale.commit thiếu dòng hàng')
      for (const it of sale.items) {
        const p = await dbx.products.get(it.productId)
        if (!p) throw new Error('sale.commit thiếu SP ' + it.productId)
      }
      if (sale.customerId) {
        const c = await dbx.customers.get(sale.customerId)
        if (!c) throw new Error('sale.commit thiếu khách ' + sale.customerId)
      }
      await dbx.sales.add(sale)
      for (const it of sale.items) {
        const p = await dbx.products.get(it.productId)
        if (!p) throw new Error('sale.commit thiếu SP ' + it.productId)
        const deducted = it.qty * it.unitRatio
        p.stock -= deducted
        p.updatedAt = Date.now()
        if (p.batches?.length) {
          p.batches = consumeBatchesFefo(p.batches, deducted).batches
          p.expiry = liveBatchExpiry(p.batches) || p.expiry
          for (const b of p.batches) await dbx.batches.put(b)
        }
        await dbx.products.put(p)
        await dbx.stockMoves.add({
          id: 'mv_' + op.id + '_' + it.productId, productId: it.productId, type: 'sale',
          qty: -(it.qty * it.unitRatio), cost: it.cost, note: 'Bán: ' + it.name,
          refId: sale.id, date: sale.date, ts: Date.now(),
        })
      }
      if (sale.customerId) {
        const c = await dbx.customers.get(sale.customerId)
        if (c) {
          c.debt += sale.debtAmount || 0
          c.totalSpent += sale.total
          c.orderCount += 1
          c.updatedAt = Date.now()
          await dbx.customers.put(c)
        }
      }
      return
    }
    case 'sale.void': {
      const { saleId, reason } = op.payload as { saleId: string; reason?: string }
      const sale = await dbx.sales.get(saleId)
      if (!sale) throw new Error('sale.void chưa có đơn ' + saleId)
      if (sale.voided) return
      for (const it of sale.items) {
        if (!(await dbx.products.get(it.productId))) throw new Error('sale.void thiếu SP ' + it.productId)
      }

      sale.voided = true
      sale.voidedAt = new Date().toISOString()
      sale.voidReason = reason ?? ''
      await dbx.sales.put(sale)

      for (const it of sale.items) {
        const p = await dbx.products.get(it.productId)
        if (p) {
          const add = it.qty * it.unitRatio
          p.stock += add
          p.updatedAt = Date.now()
          if (p.batches?.length) {
            p.batches = restoreBatchesFefo(p.batches, add)
            p.expiry = liveBatchExpiry(p.batches) || p.expiry
            for (const b of p.batches) await dbx.batches.put(b)
          }
          await dbx.products.put(p)
        }
        await dbx.stockMoves.add({
          id: 'mv_' + op.id + '_' + it.productId, productId: it.productId, type: 'void_restore',
          qty: it.qty * it.unitRatio, cost: it.cost, note: 'Hoàn kho do hủy đơn',
          refId: sale.id, date: new Date().toISOString(), ts: Date.now(),
        })
      }

      if (sale.customerId) {
        const c = await dbx.customers.get(sale.customerId)
        if (c) {
          if (sale.debtAmount > 0) c.debt = Math.max(0, c.debt - sale.debtAmount)
          c.totalSpent -= sale.total
          c.orderCount = Math.max(0, c.orderCount - 1)
          c.updatedAt = Date.now()
          await dbx.customers.put(c)
        }
      }
      return
    }
    case 'product.upsert': {
      const { product } = op.payload as { product: Partial<Product> & { id: string } }
      const cur = await dbx.products.get(product.id)
      if (cur) {
        // Tombstone thắng upsert cũ hơn — không sống lại
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
      const pl = op.payload as StockAdjustPayload
      const mvId = 'mv_' + op.id
      if (await dbx.stockMoves.get(mvId)) return
      const p = await dbx.products.get(pl.productId)
      if (!p) throw new Error('stock.adjust thiếu SP ' + pl.productId)
      p.stock += pl.delta
      p.updatedAt = Date.now()
      await dbx.products.put(p)
      await dbx.stockMoves.add({
        id: mvId, productId: pl.productId, type: 'adjust', qty: pl.delta,
        cost: p.cost, note: pl.reason, refId: pl.refId ?? '', date: new Date().toISOString(), ts: Date.now(),
      })
      return
    }
    case 'stocktake.commit': {
      const rec = op.payload as StocktakeRecord
      if (!(await dbx.stocktakes.get(rec.id))) await dbx.stocktakes.add(rec)
      for (const row of rec.rows) {
        const p = await dbx.products.get(row.productId)
        if (!p) throw new Error('stocktake thiếu SP ' + row.productId)
        if (p.stockSetHlc && compareHlc(op.hlc, p.stockSetHlc) <= 0) continue
        // Cộng diff (actual − system), không set tuyệt đối. Máy đếm gửi
        // system = tồn họ thấy; máy kia đã bán rồi thì localStock ≠ system,
        // set actual sẽ hoàn đơn đã đẩy. pending outbox = localStock − system
        // khi đơn chưa trừ kho — cùng một phép cộng diff.
        const diff = typeof row.diff === 'number' ? row.diff : row.actual - row.system
        if (diff === 0) {
          p.stockSetHlc = op.hlc
          p.updatedAt = Date.now()
          await dbx.products.put(p)
          continue
        }
        const mvId = 'mv_' + op.id + '_' + row.productId
        if (await dbx.stockMoves.get(mvId)) continue
        p.stock += diff
        await applyStockDeltaToBatches(p, diff)
        p.stockSetHlc = op.hlc
        p.updatedAt = Date.now()
        await dbx.products.put(p)
        await dbx.stockMoves.add({
          id: mvId, productId: row.productId, type: 'stocktake', qty: diff,
          cost: p.cost, note: 'Kiểm kê: ' + (diff > 0 ? 'thừa' : 'thiếu') + ' ' + Math.abs(diff),
          refId: rec.id, date: rec.date, ts: rec.ts,
        })
      }
      return
    }
    case 'debt.pay': {
      const dp = op.payload as DebtPayment
      if (await dbx.debtPayments.get(dp.id)) return
      await dbx.debtPayments.add(dp)
      const c = await dbx.customers.get(dp.customerId)
      if (!c) throw new Error('debt.pay thiếu khách ' + dp.customerId)
      c.debt = Math.max(0, c.debt - dp.amount)
      c.updatedAt = Date.now()
      await dbx.customers.put(c)
      return
    }
    case 'gr.commit': {
      const { gr, patches, supplierDelta } = op.payload as GrCommitPayload
      if (await dbx.goodsReceipts.get(gr.id)) return
      await dbx.goodsReceipts.add(gr)
      for (const pt of patches) {
        const p = await dbx.products.get(pt.productId)
        if (!p) throw new Error('gr.commit thiếu SP ' + pt.productId)
        p.stock += pt.addQty
        if (!p.grHlc || compareHlc(op.hlc, p.grHlc) > 0) {
          p.cost = pt.newCost
          if (pt.newPrice) p.price = pt.newPrice
          if (pt.expiry) p.expiry = pt.expiry
          p.grHlc = op.hlc
        }
        for (const b of pt.batches) {
          if (!(await dbx.batches.get(b.id))) {
            await dbx.batches.add(b)
            p.batches = [...(p.batches || []), b]
          }
        }
        p.updatedAt = Date.now()
        await dbx.products.put(p)
        for (const pl of pt.priceLogRows) if (!(await dbx.priceLog.get(pl.id))) await dbx.priceLog.add(pl)
        await dbx.stockMoves.add({
          id: 'mv_' + op.id + '_' + pt.productId, productId: pt.productId, type: 'purchase',
          qty: pt.addQty, cost: pt.newCost, note: 'Nhập: ' + gr.code, refId: gr.id, date: gr.date, ts: Date.now(),
        })
      }
      if (supplierDelta) {
        const sup = await dbx.suppliers.get(supplierDelta.supplierId)
        if (sup) {
          sup.debt += supplierDelta.debtDelta
          sup.totalPurchased += supplierDelta.purchasedDelta
          sup.orderCount += 1
          sup.updatedAt = Date.now()
          await dbx.suppliers.put(sup)
        }
      }
      return
    }
    case 'settings.set': {
      const { key, value } = op.payload as SettingsSetPayload
      const hlcKey = 'hlc:' + key
      const cur = await dbx.meta.get(hlcKey)
      if (cur && compareHlc(op.hlc, cur.value as string) <= 0) return
      await dbx.meta.put({ key, value })
      await dbx.meta.put({ key: hlcKey, value: op.hlc })
      return
    }
    case 'customer.upsert': {
      const { customer } = op.payload as { customer: Partial<Customer> & { id: string } }
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
      const { customerId } = op.payload as { customerId: string }
      const cur = await dbx.customers.get(customerId)
      if (cur && (!cur.deletedHlc || compareHlc(op.hlc, cur.deletedHlc) > 0)) {
        await dbx.customers.put({ ...cur, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
      }
      return
    }
    case 'product.delete': {
      const { productId } = op.payload as { productId: string }
      const cur = await dbx.products.get(productId)
      if (cur && (!cur.deletedHlc || compareHlc(op.hlc, cur.deletedHlc) > 0)) {
        await dbx.products.put({ ...cur, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
      }
      return
    }
    case 'supplier.upsert': {
      const { supplier } = op.payload as { supplier: Partial<Supplier> & { id: string } }
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
      const pay = op.payload as SupplierPayment
      if (!pay?.id || !pay.supplierId || !(pay.amount > 0)) throw new Error('supplier.pay thiếu dữ liệu')
      if (await dbx.supplierPayments.get(pay.id)) return
      await dbx.supplierPayments.add(pay)
      return
    }
    case 'po.upsert': {
      const po = op.payload as PurchaseOrder
      if (!po?.id) throw new Error('po.upsert thiếu id')
      const cur = await dbx.purchaseOrders.get(po.id)
      if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      await dbx.purchaseOrders.put({ ...po, hlc: op.hlc })
      return
    }
    case 'invoice.upsert': {
      const inv = op.payload as InvoiceRecord
      if (!inv?.id) throw new Error('invoice.upsert thiếu id')
      const cur = await dbx.invoices.get(inv.id)
      if (cur?.deletedHlc && compareHlc(op.hlc, cur.deletedHlc) <= 0) return
      if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      // Giữ tombstone nếu payload không gỡ xóa tường minh
      await dbx.invoices.put({
        ...cur, ...inv,
        deleted: inv.deleted ?? cur?.deleted,
        deletedHlc: cur?.deletedHlc,
        hlc: op.hlc,
      })
      return
    }
    case 'invoice.delete': {
      const { invoiceId } = op.payload as { invoiceId: string }
      if (!invoiceId) return
      const cur = await dbx.invoices.get(invoiceId)
      if (cur) {
        if (!cur.deletedHlc || compareHlc(op.hlc, cur.deletedHlc) > 0) {
          await dbx.invoices.put({ ...cur, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
        }
      } else {
        await dbx.invoices.put({
          id: invoiceId, code: '', type: 'import', date: '', amount: 0, tax: 0,
          status: 'draft', data: {}, ts: 0, deleted: true, deletedHlc: op.hlc, hlc: op.hlc,
        })
      }
      return
    }
    case 'pricing.upsert': {
      const rule = op.payload as PricingRule
      if (!rule?.id) throw new Error('pricing.upsert thiếu id')
      const cur = await dbx.pricingRules.get(rule.id)
      if (cur?.deletedHlc && compareHlc(op.hlc, cur.deletedHlc) <= 0) return
      if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      await dbx.pricingRules.put({
        ...cur, ...rule,
        deleted: rule.deleted ?? cur?.deleted,
        deletedHlc: cur?.deletedHlc,
        hlc: op.hlc,
      })
      return
    }
    case 'pricing.delete': {
      const { ruleId } = op.payload as { ruleId: string }
      if (!ruleId) return
      const cur = await dbx.pricingRules.get(ruleId)
      if (cur) {
        if (!cur.deletedHlc || compareHlc(op.hlc, cur.deletedHlc) > 0) {
          await dbx.pricingRules.put({ ...cur, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
        }
      } else {
        await dbx.pricingRules.put({
          id: ruleId, name: '', cat: '', marginPct: 0, roundTo: 0, active: false,
          deleted: true, deletedHlc: op.hlc, hlc: op.hlc,
        })
      }
      return
    }
    case 'note.upsert': {
      const note = op.payload as Note
      const cur = await dbx.notes.get(note.id)
      if (cur?.deletedHlc && compareHlc(op.hlc, cur.deletedHlc) <= 0) return
      if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      await dbx.notes.put({
        ...cur, ...note,
        deleted: note.deleted ?? cur?.deleted,
        deletedHlc: cur?.deletedHlc,
        hlc: op.hlc,
      })
      return
    }
    case 'note.delete': {
      const { noteId } = op.payload as { noteId: string }
      if (!noteId) return
      const cur = await dbx.notes.get(noteId)
      if (cur) {
        if (!cur.deletedHlc || compareHlc(op.hlc, cur.deletedHlc) > 0) {
          await dbx.notes.put({ ...cur, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
        }
      } else {
        await dbx.notes.put({
          id: noteId, text: '', date: '', type: 'note', done: false, pinned: false,
          deleted: true, deletedHlc: op.hlc, hlc: op.hlc,
        })
      }
      return
    }
    case 'user.upsert': {
      const { user } = op.payload as { user: User }
      if (!user?.id) throw new Error('user.upsert thiếu id')
      const cur = await dbx.users.get(user.id)
      if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      await dbx.users.put({ ...user, hlc: op.hlc })
      return
    }
    case 'user.password': {
      const p = op.payload as {
        userId: string
        passwordHash: string
        salt: string
        passwordNeedsReset?: boolean
        updatedAt?: number
      }
      if (!p.userId || !p.passwordHash || !p.salt) throw new Error('user.password thiếu dữ liệu')
      const cur = await dbx.users.get(p.userId)
      if (!cur) return
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
      const { userId } = op.payload as { userId: string }
      const cur = await dbx.users.get(userId)
      if (cur && (!cur.hlc || compareHlc(op.hlc, cur.hlc) > 0)) {
        await dbx.users.put({ ...cur, deleted: true, active: false, hlc: op.hlc })
      }
      return
    }
    case 'device.upsert': {
      const { device } = op.payload as { device: PairedDevice }
      if (!device?.deviceId) throw new Error('device.upsert thiếu deviceId')
      const thisId = await getThisDeviceId()
      await dbx.devices.put({ ...device, isThis: device.deviceId === thisId })
      return
    }
    case 'device.remove': {
      const { deviceId } = op.payload as { deviceId: string }
      if (!deviceId) throw new Error('device.remove thiếu deviceId')
      const thisId = await getThisDeviceId()
      if (deviceId === thisId) return
      const existing = await dbx.devices.where('deviceId').equals(deviceId).first()
      if (existing) await dbx.devices.delete(existing.id)
      return
    }
  }
}
