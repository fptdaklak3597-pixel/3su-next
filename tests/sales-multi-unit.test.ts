import { beforeEach, describe, expect, it } from 'vitest'
import { dbx, DEFAULT_SETTINGS } from '@/core/db'
import { confirmSale } from '@/core/domain/sales'
import { applyOps } from '@/core/sync/apply'
import { initSyncEngine, makeOp } from '@/core/sync/engine'
import type { Customer, Product, Sale, SyncOp } from '@/core/types'

function product(stock: number): Product {
  return {
    id: 'p1', name: 'Nước ngọt', cat: 'Nước', price: 10000, cost: 6000, stock,
    unit: 'chai', barcode: '', expiry: '', units: [{ n: 'lốc', r: 6 }],
    wholesalePrice: 0, batches: [], createdAt: 1, updatedAt: 1,
  }
}

function customer(): Customer {
  return {
    id: 'c1', name: 'Khách thử', phone: '', note: '', debt: 0, totalSpent: 0,
    orderCount: 0, createdAt: 1, updatedAt: 1,
  }
}

function remoteOp(type: SyncOp['type'], payload: unknown): SyncOp {
  return { ...makeOp(type, payload), deviceId: 'remote-device' }
}

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(), dbx.stockMoves.clear(),
    dbx.batches.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
  ])
  await initSyncEngine()
})

describe('confirmSale multi-unit', () => {
  it('kiểm tổng số lượng gốc của cùng sản phẩm trước khi trừ kho', async () => {
    const p = product(10)
    await dbx.products.put(p)
    await dbx.meta.put({ key: 'settings', value: { ...DEFAULT_SETTINGS, allowNegativeStock: false } })

    await expect(confirmSale({
      items: [
        { productId: p.id, qty: 1, unitName: 'lốc', unitRatio: 6 },
        { productId: p.id, qty: 5, unitName: 'chai', unitRatio: 1 },
      ],
      products: [p], discount: 0, payMethod: 'cash', tendered: 200000,
      customerId: null, wholesale: false,
    })).rejects.toThrow(/không đủ tồn/)

    expect((await dbx.products.get(p.id))?.stock).toBe(10)
    expect(await dbx.sales.count()).toBe(0)
    expect(await dbx.syncQueue.count()).toBe(0)
  })

  it('bán đúng khi tổng số lượng vừa đủ tồn', async () => {
    const p = product(11)
    await dbx.products.put(p)
    await dbx.meta.put({ key: 'settings', value: { ...DEFAULT_SETTINGS, allowNegativeStock: false } })

    const { sale } = await confirmSale({
      items: [
        { productId: p.id, qty: 1, unitName: 'lốc', unitRatio: 6 },
        { productId: p.id, qty: 5, unitName: 'chai', unitRatio: 1 },
      ],
      products: [p], discount: 0, payMethod: 'cash', tendered: 200000,
      customerId: null, wholesale: false,
    })

    expect(sale.items).toHaveLength(2)
    expect((await dbx.products.get(p.id))?.stock).toBe(0)
    expect(await dbx.stockMoves.count()).toBe(2)
  })

  it('kẹp discount âm về 0 và chuyển tendered không hữu hạn thành phần nợ có khách', async () => {
    const p = product(10)
    const c = customer()
    await dbx.products.put(p)
    await dbx.customers.put(c)

    const { sale } = await confirmSale({
      items: [{ productId: p.id, qty: 1, unitName: 'chai', unitRatio: 1 }],
      products: [p], discount: -5000, payMethod: 'cash', tendered: Number.NaN,
      customerId: c.id, wholesale: false,
    })

    expect(sale.discount).toBe(0)
    expect(sale.tendered).toBe(0)
    expect(sale.debtAmount).toBe(10000)
    expect((await dbx.customers.get(c.id))?.debt).toBe(10000)
  })
})

describe('remote sale with repeated product lines', () => {
  it('áp và hủy đơn không trùng stock-move id', async () => {
    const p = product(11)
    await dbx.products.put(p)
    const sale: Sale = {
      id: 'sale-remote',
      items: [
        { productId: p.id, name: p.name, qty: 1, price: 60000, cost: 36000, unit: 'lốc', unitRatio: 6 },
        { productId: p.id, name: p.name, qty: 5, price: 10000, cost: 6000, unit: 'chai', unitRatio: 1 },
      ],
      total: 110000, profit: 44000, discount: 0, payMethod: 'cash',
      tendered: 110000, change: 0, debtAmount: 0, customerId: null,
      date: new Date().toISOString(),
    }

    expect(await applyOps([remoteOp('sale.commit', sale)])).toBe(1)
    expect((await dbx.products.get(p.id))?.stock).toBe(0)
    expect(await dbx.sales.get(sale.id)).toBeTruthy()

    expect(await applyOps([remoteOp('sale.void', { saleId: sale.id, reason: 'test' })])).toBe(1)
    expect((await dbx.products.get(p.id))?.stock).toBe(11)

    const moves = (await dbx.stockMoves.toArray()).filter((m) => m.refId === sale.id)
    expect(moves).toHaveLength(4)
    expect(new Set(moves.map((m) => m.id)).size).toBe(4)
  })
})
