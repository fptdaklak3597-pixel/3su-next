import { describe, it, expect } from 'vitest'
import { reconcileFrom } from '@/core/domain/reconcile'
import type { Customer, Product, Sale, StockMove, DebtPayment } from '@/core/types'

function p(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', name: 'SP', cat: 'Khác', price: 1, cost: 1, stock: 10, unit: 'cái',
    barcode: '', expiry: '', units: [], wholesalePrice: 0, batches: [],
    createdAt: 1, updatedAt: 1, ...over,
  }
}

function c(over: Partial<Customer> = {}): Customer {
  return {
    id: 'c1', name: 'Khách', phone: '', note: '', debt: 5000, totalSpent: 0,
    orderCount: 0, createdAt: 1, updatedAt: 1, ...over,
  }
}

describe('reconcileFrom', () => {
  it('khớp khi tồn = tổng stockMoves', () => {
    const moves: StockMove[] = [
      { id: 'm1', productId: 'p1', type: 'adjust', qty: 12, cost: 1, note: '', refId: '', date: '', ts: 1 },
      { id: 'm2', productId: 'p1', type: 'sale', qty: -2, cost: 1, note: '', refId: '', date: '', ts: 2 },
    ]
    const r = reconcileFrom([p({ stock: 10 })], [], [], moves, [])
    expect(r.stockDrifts).toEqual([])
    expect(r.stockOk).toBe(1)
  })

  it('cờ lệch tồn', () => {
    const moves: StockMove[] = [
      { id: 'm1', productId: 'p1', type: 'adjust', qty: 10, cost: 1, note: '', refId: '', date: '', ts: 1 },
    ]
    const r = reconcileFrom([p({ stock: 7 })], [], [], moves, [])
    expect(r.stockDrifts[0]?.drift).toBe(-3)
  })

  it('nợ = đơn chưa hủy − thu', () => {
    const sales: Sale[] = [
      {
        id: 's1', items: [], total: 10000, profit: 0, discount: 0, payMethod: 'cash',
        tendered: 5000, change: 0, debtAmount: 5000, customerId: 'c1', date: '2026-01-01',
      },
    ]
    const pays: DebtPayment[] = [
      { id: 'd1', customerId: 'c1', amount: 2000, date: '2026-01-02', note: '' },
    ]
    const r = reconcileFrom([], [c({ debt: 3000 })], sales, [], pays)
    expect(r.debtDrifts).toEqual([])
    expect(r.debtOk).toBe(1)
  })
})
