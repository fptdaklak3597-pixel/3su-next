/**
 * Chiếu SaleCommitted lên sổ local của máy vừa bán.
 * Không enqueue sale.commit. Máy khác vẫn chờ cầu event (chưa nối reconnect ritual).
 */
import { dbx } from '../db'
import { consumeBatchesFefoAllowNegative, liveBatchExpiry } from '../domain/inventory'
import { notifyDbChanged } from '../offline'
import type { Sale } from '../types'

function nextAuthMoveId(saleId: string, productId: string, occurrences: Map<string, number>): string {
  const n = occurrences.get(productId) ?? 0
  occurrences.set(productId, n + 1)
  return n === 0 ? `mv_auth_${saleId}_${productId}` : `mv_auth_${saleId}_${productId}_${n}`
}

export async function projectAuthoritativeSale(sale: Sale): Promise<void> {
  if (!sale?.id || !Array.isArray(sale.items) || sale.items.length === 0) {
    throw new Error('SaleCommitted thiếu id hoặc dòng hàng')
  }
  await dbx.transaction(
    'rw',
    [dbx.sales, dbx.products, dbx.stockMoves, dbx.customers, dbx.batches],
    async () => {
      if (await dbx.sales.get(sale.id)) return
      if (sale.customerId) {
        const c = await dbx.customers.get(sale.customerId)
        if (!c) throw new Error('Không tìm thấy khách hàng')
      }
      const occurrences = new Map<string, number>()
      for (const it of sale.items) {
        if (!it?.productId || !Number.isFinite(it.qty) || !Number.isFinite(it.unitRatio) || it.qty <= 0 || it.unitRatio <= 0) {
          throw new Error('SaleCommitted có dòng hàng không hợp lệ')
        }
        const p = await dbx.products.get(it.productId)
        if (!p || p.deleted) throw new Error('Không tìm thấy hàng: ' + (it.name || it.productId))
        const deducted = it.qty * it.unitRatio
        p.stock -= deducted
        p.updatedAt = Date.now()
        if (p.batches?.length) {
          p.batches = consumeBatchesFefoAllowNegative(p.batches, deducted)
          p.expiry = liveBatchExpiry(p.batches)
          for (const b of p.batches) await dbx.batches.put(b)
        }
        await dbx.products.put(p)
        await dbx.stockMoves.add({
          id: nextAuthMoveId(sale.id, it.productId, occurrences),
          productId: p.id,
          type: 'sale',
          qty: -deducted,
          cost: it.cost,
          note: 'Bán: ' + it.name,
          refId: sale.id,
          date: sale.date,
          ts: Date.now(),
        })
      }
      await dbx.sales.add(sale)
      if (sale.customerId) {
        const c = await dbx.customers.get(sale.customerId)
        if (!c) throw new Error('Không tìm thấy khách hàng')
        c.debt += sale.debtAmount || 0
        c.totalSpent += sale.total
        c.orderCount += 1
        c.updatedAt = Date.now()
        await dbx.customers.put(c)
      }
    },
  )
  notifyDbChanged()
}
