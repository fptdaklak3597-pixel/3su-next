import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine, makeOp } from '@/core/sync/engine'
import { applyOps } from '@/core/sync/apply'
import { hlcString } from '@/core/sync/hlc'
import type { Product, Sale, SyncOp } from '@/core/types'

function mkProduct(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', name: 'SP', cat: 'Khác', price: 5000, cost: 3000,
    stock: 100, unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: Date.now(), updatedAt: Date.now(), ...over,
  }
}

function remoteOp(type: SyncOp['type'], payload: unknown, hlc?: string): SyncOp {
  const op = makeOp(type, payload)
  return { ...op, deviceId: 'dev_remote', ...(hlc ? { hlc, id: hlc } : {}) }
}

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
    dbx.debtPayments.clear(), dbx.stockMoves.clear(), dbx.batches.clear(),
    dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
  ])
  await initSyncEngine()
})

describe('sale.commit vs stockSetHlc', () => {
  it('sale HLC cũ hơn stocktake → giữ tồn kiểm kê, vẫn ghi đơn', async () => {
    const stockSet = hlcString(2000, 0, 'st')
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10, stockSetHlc: stockSet, batches: [] }))

    const sale: Sale = {
      id: 's_late',
      items: [{ productId: 'p1', name: 'SP', qty: 2, price: 1000, cost: 500, unit: 'cái', unitRatio: 1 }],
      total: 2000,
      profit: 1000,
      discount: 0,
      payMethod: 'cash',
      tendered: 2000,
      change: 0,
      debtAmount: 0,
      customerId: null,
      date: new Date().toISOString(),
      synced: true,
    }
    await applyOps([remoteOp('sale.commit', sale, hlcString(1000, 0, 'sale'))])

    expect((await dbx.products.get('p1'))!.stock).toBe(10)
    expect(await dbx.sales.get('s_late')).toBeTruthy()
  })
})
