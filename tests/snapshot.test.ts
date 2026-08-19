import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import { confirmSale } from '@/core/domain/sales'
import { exportSnapshot, importSnapshot } from '@/core/sync/snapshot'
import type { Product, ProductBatch, PriceLogEntry, Note } from '@/core/types'

let seq = 0
function mkProduct(over: Partial<Product> = {}): Product {
  seq += 1
  return {
    id: 'p' + seq, name: 'Sản phẩm ' + seq, cat: 'Khác', price: 5000, cost: 3000,
    stock: 100, unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: Date.now(), updatedAt: Date.now(), ...over,
  }
}

beforeEach(async () => {
  await Promise.all([dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
    dbx.debtPayments.clear(), dbx.goodsReceipts.clear(), dbx.stockMoves.clear(),
    dbx.stocktakes.clear(), dbx.notes.clear(), dbx.batches.clear(), dbx.priceLog.clear(),
    dbx.suppliers.clear(), dbx.supplierPayments.clear(),
    dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear()])
  await initSyncEngine()
})

describe('snapshot', () => {
  it('exportSnapshot → wipe → importSnapshot khôi phục đủ bảng kể cả batches/priceLog/notes', async () => {
    const p = mkProduct({ id: 'p1', stock: 10 })
    await dbx.products.put(p)
    const batch: ProductBatch = { id: 'bt1', qty: 5, remain: 5, cost: 1000, expiry: '2026-12-31', date: '2026-08-14' }
    const pl: PriceLogEntry = { id: 'pl1', productId: 'p1', supId: 'sp1', supName: 'NCC', cost: 1000, ts: Date.now() }
    const note: Note = { id: 'n1', text: 'ghi chú', date: new Date().toISOString(), type: 'note', done: false, pinned: false }
    await dbx.batches.put(batch)
    await dbx.priceLog.put(pl)
    await dbx.notes.put(note)

    const { snapshot } = await exportSnapshot()

    // wipe toàn bộ bảng business
    await Promise.all([dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
      dbx.debtPayments.clear(), dbx.goodsReceipts.clear(), dbx.stockMoves.clear(),
      dbx.stocktakes.clear(), dbx.notes.clear(), dbx.batches.clear(), dbx.priceLog.clear(),
      dbx.suppliers.clear(), dbx.supplierPayments.clear()])

    await importSnapshot(snapshot)

    expect((await dbx.products.get('p1'))!.stock).toBe(10)
    expect((await dbx.batches.get('bt1'))!.id).toBe('bt1')
    expect((await dbx.priceLog.get('pl1'))!.cost).toBe(1000)
    expect((await dbx.notes.get('n1'))!.text).toBe('ghi chú')
    expect(await dbx.meta.get('ui:web-light-v2')).toBeUndefined()
  })

  it('importSnapshot KHÔNG nuốt op local chưa đẩy: op pending được áp lại lên snapshot', async () => {
    const p = mkProduct({ id: 'p1', stock: 10 })
    await dbx.products.put(p)
    const { snapshot } = await exportSnapshot() // máy A snapshot lúc stock 10

    // bán 2 → stock 8, op sale.commit vào outbox
    const { sale } = await confirmSale({
      items: [{ productId: 'p1', qty: 2, unitName: 'cái', unitRatio: 1 }],
      products: [p], discount: 0, payMethod: 'cash', tendered: 20000, customerId: null, wholesale: false,
    })
    expect((await dbx.products.get('p1'))!.stock).toBe(8)

    await importSnapshot(snapshot) // khôi phục máy từ snapshot cũ

    expect((await dbx.products.get('p1'))!.stock).toBe(8) // 10 - 2
    expect(await dbx.sales.get(sale.id)).toBeTruthy()
    expect(await dbx.syncQueue.count()).toBe(1) // op vẫn còn trong outbox
  })
})
