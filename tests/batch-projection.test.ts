import { beforeEach, describe, expect, it } from 'vitest'
import { dbx } from '@/core/db'
import {
  reconcileAllBatchProjections,
  reconcileProductBatchProjections,
} from '@/core/domain/batchProjection'
import { applyOps } from '@/core/sync/apply'
import { initSyncEngine, makeOp } from '@/core/sync/engine'
import type { Product, ProductBatch, Sale, SyncOp } from '@/core/types'

function batch(over: Partial<ProductBatch> = {}): ProductBatch {
  return {
    id: 'b1',
    qty: 10,
    remain: 10,
    cost: 100,
    expiry: '2027-01-01',
    date: '2026-08-20',
    supId: '',
    supName: 'NCC',
    ...over,
  }
}

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', name: 'SP', cat: 'Khác', price: 200, cost: 100, stock: 10,
    unit: 'cái', barcode: '', expiry: '2027-01-01', units: [], wholesalePrice: 0,
    batches: [batch()], createdAt: 1, updatedAt: 1, ...over,
  }
}

function remote(type: SyncOp['type'], payload: unknown): SyncOp {
  return { ...makeOp(type, payload), deviceId: 'remote-device' }
}

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(), dbx.batches.clear(), dbx.sales.clear(),
    dbx.stockMoves.clear(), dbx.customers.clear(), dbx.syncQueue.clear(),
    dbx.appliedOps.clear(), dbx.meta.clear(), dbx.goodsReceipts.clear(),
    dbx.stocktakes.clear(), dbx.suppliers.clear(), dbx.supplierPayments.clear(),
  ])
  await initSyncEngine()
})

describe('batch projection repair', () => {
  it('rebuild toàn bộ mirror từ Product.batches và loại orphan', async () => {
    await dbx.products.put(product({ expiry: '2099-01-01' }))
    await dbx.batches.put(batch({ id: 'legacy-row' }))
    await dbx.batches.put(batch({ id: 'orphan', productId: 'missing-product' }))

    const stats = await reconcileAllBatchProjections()
    const saved = (await dbx.products.get('p1'))!
    const rows = await dbx.batches.toArray()

    expect(stats.products).toBe(1)
    expect(saved.expiry).toBe('2027-01-01')
    expect(saved.batches).toHaveLength(1)
    expect(saved.batches[0]?.productId).toBe('p1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'b1', productId: 'p1', remain: 10 })
  })

  it('xóa stale mirror của riêng sản phẩm', async () => {
    await dbx.products.put(product())
    await reconcileAllBatchProjections()
    await dbx.batches.put(batch({ id: 'stale', productId: 'p1' }))

    await reconcileProductBatchProjections(['p1'])

    expect((await dbx.batches.toArray()).map((row) => row.id)).toEqual(['b1'])
  })
})

describe('remote inventory convergence', () => {
  it('stock.adjust cập nhật stock, FEFO và mirror trong cùng apply', async () => {
    await dbx.products.put(product())
    await reconcileAllBatchProjections()

    await applyOps([remote('stock.adjust', { productId: 'p1', delta: -3, reason: 'edit' })])
    let saved = (await dbx.products.get('p1'))!
    let mirrored = (await dbx.batches.get('b1'))!
    expect(saved.stock).toBe(7)
    expect(saved.batches[0]?.remain).toBe(7)
    expect(mirrored).toMatchObject({ productId: 'p1', remain: 7 })

    await applyOps([remote('stock.adjust', { productId: 'p1', delta: 2, reason: 'count' })])
    saved = (await dbx.products.get('p1'))!
    expect(saved.stock).toBe(9)
    expect(saved.batches.some((row) => row.productId === 'p1' && row.remain === 2 && row.supName === 'Kiểm kê')).toBe(true)
    expect((await dbx.batches.where('productId').equals('p1').count())).toBe(saved.batches.length)
  })

  it('sale.commit rồi sale.void giữ embedded/mirror hội tụ', async () => {
    await dbx.products.put(product())
    await reconcileAllBatchProjections()
    const sale: Sale = {
      id: 's1',
      items: [{ productId: 'p1', name: 'SP', qty: 2, price: 200, cost: 100, unit: 'cái', unitRatio: 1 }],
      total: 400, profit: 200, discount: 0, payMethod: 'cash',
      tendered: 400, change: 0, debtAmount: 0, customerId: null,
      date: '2026-08-20T00:00:00.000Z',
    }

    await applyOps([remote('sale.commit', sale)])
    let saved = (await dbx.products.get('p1'))!
    expect(saved.stock).toBe(8)
    expect(saved.batches[0]?.remain).toBe(8)
    expect((await dbx.batches.get('b1'))).toMatchObject({ productId: 'p1', remain: 8 })

    await applyOps([remote('sale.void', { saleId: sale.id, reason: 'test' })])
    saved = (await dbx.products.get('p1'))!
    expect(saved.stock).toBe(10)
    expect(saved.batches[0]?.remain).toBe(10)
    expect((await dbx.batches.get('b1'))).toMatchObject({ productId: 'p1', remain: 10 })
  })
})
