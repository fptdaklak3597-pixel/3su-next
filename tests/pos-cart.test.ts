/**
 * Đợt 1 POS — giỏ cộng dồn, giảm %, cảnh kho, beep, ghi nợ cả đơn.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import {
  confirmSale,
  mergeCartLine,
  setCartLineQty,
  removeCartLine,
  discountToAmount,
  stockAddWarning,
  type CartItem,
} from '@/core/domain/sales'
import { playPosSound } from '@/core/browser/posSound'
import type { Product, Customer } from '@/core/types'

function line(over: Partial<CartItem> = {}): CartItem {
  return { productId: 'p1', qty: 1, unitName: 'cái', unitRatio: 1, ...over }
}

describe('mergeCartLine', () => {
  it('cộng dồn cùng SP cùng đơn vị', () => {
    const next = mergeCartLine([line({ qty: 2 })], line({ qty: 3 }))
    expect(next).toEqual([line({ qty: 5 })])
  })

  it('thêm dòng mới nếu khác đơn vị', () => {
    const next = mergeCartLine(
      [line({ unitName: 'chai', unitRatio: 1 })],
      line({ unitName: 'thùng', unitRatio: 24, qty: 1 }),
    )
    expect(next).toHaveLength(2)
    expect(next[1].unitName).toBe('thùng')
  })
})

describe('setCartLineQty / removeCartLine', () => {
  it('gõ SL > 0 thì ghi đè', () => {
    expect(setCartLineQty([line({ qty: 1 })], 0, 12)[0].qty).toBe(12)
  })

  it('SL <= 0 thì xóa dòng', () => {
    expect(setCartLineQty([line(), line({ productId: 'p2' })], 0, 0)).toEqual([line({ productId: 'p2' })])
  })

  it('xóa đúng index', () => {
    expect(removeCartLine([line(), line({ productId: 'p2' })], 0)).toEqual([line({ productId: 'p2' })])
  })

  it('đổi đơn vị: gộp vào dòng cùng SP+đơn vị, không để hai dòng trùng', () => {
    const cart = [
      line({ unitName: 'chai', unitRatio: 1, qty: 2 }),
      line({ unitName: 'thùng', unitRatio: 24, qty: 1 }),
    ]
    const item = cart[0]!
    const next = mergeCartLine(removeCartLine(cart, 0), { ...item, unitName: 'thùng', unitRatio: 24 })
    expect(next).toEqual([line({ unitName: 'thùng', unitRatio: 24, qty: 3 })])
  })
})

describe('discountToAmount', () => {
  it('số tiền không vượt tạm tính', () => {
    expect(discountToAmount(100000, 150000, 'amount')).toBe(100000)
  })

  it('phần trăm làm tròn, kẹp 0–tạm tính', () => {
    expect(discountToAmount(100000, 10, 'percent')).toBe(10000)
    expect(discountToAmount(0, 10, 'percent')).toBe(0)
  })
})

describe('stockAddWarning', () => {
  it('hết hàng khi tồn sau thêm < 0', () => {
    expect(stockAddWarning(2, 3)).toBe('out')
    expect(stockAddWarning(2, 2)).toBe(null)
  })
})

describe('playPosSound', () => {
  it('không gọi beep khi tắt âm', () => {
    const calls: number[] = []
    expect(playPosSound('scan-ok', false, (hz) => { calls.push(hz) })).toBe(false)
    expect(calls).toEqual([])
  })

  it('gọi beep khi bật âm', () => {
    const calls: number[] = []
    expect(playPosSound('scan-miss', true, (hz) => { calls.push(hz) })).toBe(true)
    expect(calls.length).toBe(1)
  })
})

describe('confirmSale payMethod debt', () => {
  beforeEach(async () => {
    await dbx.transaction(
      'rw',
      [dbx.products, dbx.sales, dbx.customers, dbx.stockMoves, dbx.syncQueue, dbx.appliedOps, dbx.meta],
      async () => {
        await Promise.all([
          dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
          dbx.stockMoves.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
        ])
      },
    )
    await initSyncEngine()
  })

  it('ghi nợ cả đơn khi chọn Ghi nợ + có khách', async () => {
    const p: Product = {
      id: 'p-debt', name: 'Mì', cat: 'Khô', price: 10000, cost: 6000, stock: 10,
      unit: 'gói', barcode: '', expiry: '', units: [], wholesalePrice: 0, batches: [],
      createdAt: 1, updatedAt: 1,
    }
    const c: Customer = {
      id: 'c-debt', name: 'A', phone: '', note: '', debt: 0, totalSpent: 0, orderCount: 0,
      createdAt: 1, updatedAt: 1,
    }
    await dbx.products.add(p)
    await dbx.customers.add(c)
    const { sale } = await confirmSale({
      items: [{ productId: p.id, qty: 2, unitName: 'gói', unitRatio: 1 }],
      products: [p],
      discount: 0,
      payMethod: 'debt',
      tendered: 0,
      customerId: c.id,
      wholesale: false,
    })
    expect(sale.payMethod).toBe('debt')
    expect(sale.total).toBe(20000)
    expect(sale.debtAmount).toBe(20000)
    expect(sale.tendered).toBe(0)
    expect(sale.change).toBe(0)
    const after = await dbx.customers.get(c.id)
    expect(after?.debt).toBe(20000)
  })

  it('từ chối ghi nợ khi chưa chọn khách', async () => {
    const p: Product = {
      id: 'p-debt2', name: 'Mì', cat: 'Khô', price: 10000, cost: 6000, stock: 10,
      unit: 'gói', barcode: '', expiry: '', units: [], wholesalePrice: 0, batches: [],
      createdAt: 1, updatedAt: 1,
    }
    await dbx.products.add(p)
    await expect(confirmSale({
      items: [{ productId: p.id, qty: 1, unitName: 'gói', unitRatio: 1 }],
      products: [p],
      discount: 0,
      payMethod: 'debt',
      tendered: 0,
      customerId: null,
      wholesale: false,
    })).rejects.toThrow(/khách/)
  })
})
