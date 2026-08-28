import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import { consumeBatchesFefo, restoreBatchesFefo, confirmSale } from '@/core/domain/sales'
import { liveBatchExpiry, saveGoodsReceipt } from '@/core/domain/inventory'
import type { Product, ProductBatch } from '@/core/types'

function bt(over: Partial<ProductBatch> & Pick<ProductBatch, 'id' | 'remain' | 'expiry'>): ProductBatch {
  return { qty: over.qty ?? over.remain, cost: 1000, date: '2026-01-01', ...over }
}

describe('consumeBatchesFefo', () => {
  it('trừ lô HSD sớm trước', () => {
    const { batches, leftover } = consumeBatchesFefo([
      bt({ id: 'b2', remain: 5, expiry: '2026-12-01' }),
      bt({ id: 'b1', remain: 4, expiry: '2026-06-01' }),
    ], 3)
    expect(leftover).toBe(0)
    expect(batches.find((b) => b.id === 'b1')?.remain).toBe(1)
    expect(batches.find((b) => b.id === 'b2')?.remain).toBe(5)
  })

  it('hết lô sớm thì trừ lô sau', () => {
    const { batches, leftover } = consumeBatchesFefo([
      bt({ id: 'b1', remain: 2, expiry: '2026-06-01' }),
      bt({ id: 'b2', remain: 10, expiry: '2026-12-01' }),
    ], 5)
    expect(leftover).toBe(0)
    expect(batches.find((b) => b.id === 'b1')?.remain).toBe(0)
    expect(batches.find((b) => b.id === 'b2')?.remain).toBe(7)
  })
})

describe('restoreBatchesFefo', () => {
  it('cộng lại vào chỗ đã trừ (room = qty - remain)', () => {
    const next = restoreBatchesFefo([
      bt({ id: 'b1', qty: 4, remain: 1, expiry: '2026-06-01' }),
    ], 2)
    expect(next[0].remain).toBe(3)
  })
})

describe('confirmSale trừ FEFO', () => {
  beforeEach(async () => {
    await dbx.transaction('rw', [dbx.products, dbx.sales, dbx.stockMoves, dbx.batches, dbx.syncQueue, dbx.appliedOps, dbx.meta], async () => {
      await Promise.all([
        dbx.products.clear(), dbx.sales.clear(), dbx.stockMoves.clear(),
        dbx.batches.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
      ])
    })
    await initSyncEngine()
  })

  it('cập nhật remain + HSD sau khi bán', async () => {
    const batches = [
      bt({ id: 'b1', qty: 4, remain: 4, expiry: '2026-06-01' }),
      bt({ id: 'b2', qty: 6, remain: 6, expiry: '2026-12-01' }),
    ]
    const p: Product = {
      id: 'p-fefo', name: 'Sữa', cat: 'Sữa', price: 10000, cost: 7000, stock: 10,
      unit: 'hộp', barcode: '', expiry: '2026-06-01', units: [], wholesalePrice: 0,
      batches, createdAt: 1, updatedAt: 1,
    }
    await dbx.products.add(p)
    await dbx.batches.bulkAdd(batches)
    await confirmSale({
      items: [{ productId: p.id, qty: 5, unitName: 'hộp', unitRatio: 1 }],
      products: [p],
      discount: 0,
      payMethod: 'cash',
      tendered: 50000,
      customerId: null,
      wholesale: false,
    })
    const after = await dbx.products.get(p.id)
    expect(after?.stock).toBe(5)
    expect(after?.batches.find((b) => b.id === 'b1')?.remain).toBe(0)
    expect(after?.batches.find((b) => b.id === 'b2')?.remain).toBe(5)
    expect(after?.expiry).toBe(liveBatchExpiry(after?.batches || []))
    expect(after?.expiry).toBe('2026-12-01')
  })
})


describe('GR không HSD', () => {
  beforeEach(async () => {
    await dbx.transaction('rw', [dbx.products, dbx.goodsReceipts, dbx.stockMoves, dbx.batches, dbx.suppliers, dbx.supplierPayments, dbx.priceLog, dbx.syncQueue, dbx.appliedOps, dbx.meta], async () => {
      await Promise.all([
        dbx.products.clear(), dbx.goodsReceipts.clear(), dbx.stockMoves.clear(),
        dbx.batches.clear(), dbx.suppliers.clear(), dbx.supplierPayments.clear(),
        dbx.priceLog.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
      ])
    })
    await initSyncEngine()
  })

  it('tồn khớp tổng lô remain', async () => {
    const p: Product = {
      id: 'p-noexp', name: 'Gạo', cat: 'Khác', price: 20000, cost: 15000, stock: 0,
      unit: 'kg', barcode: '', expiry: '', units: [], wholesalePrice: 0,
      batches: [], createdAt: 1, updatedAt: 1,
    }
    await dbx.products.add(p)
    await saveGoodsReceipt({
      supplier: 'NCC lẻ',
      date: '2026-08-26',
      expiry: '',
      note: '',
      rows: [{ productId: p.id, name: p.name, unit: 'kg', unitRatio: 1, qty: 8, cost: 15000, expiry: '' }],
    })
    const after = await dbx.products.get(p.id)
    const remain = (after?.batches || []).reduce((a, b) => a + b.remain, 0)
    expect(after?.stock).toBe(8)
    expect(remain).toBe(8)
  })
})
