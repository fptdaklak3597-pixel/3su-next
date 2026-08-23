/**
 * Phần còn lại đợt 3–6: giọng nói, sao kê NCC, PO từng phần, báo cáo, Excel, đối soát.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import { parseQty, parseCommand } from '@/core/browser/voice'
import { supplierMonthlyStatement } from '@/core/domain/suppliers'
import { receivePurchaseOrder, createPurchaseOrder, forecastToPoRows } from '@/core/domain/purchase'
import { reportToAoa, buildReport, type ReportFilters } from '@/core/domain/reports'
import { catalogRowIssues, parseCatalogSheet } from '@/web/lib/catalogXlsx'
import { explainStockDrift, explainDebtDrift } from '@/core/domain/reconcile'
import { lastPurchaseCost } from '@/core/domain/inventory'
import type { GoodsReceipt, PriceLogEntry, Product, Sale, StockForecast, SupplierPayment } from '@/core/types'

beforeEach(async () => {
  await dbx.transaction(
    'rw',
    [dbx.products, dbx.goodsReceipts, dbx.stockMoves, dbx.suppliers, dbx.supplierPayments,
      dbx.purchaseOrders, dbx.batches, dbx.priceLog, dbx.syncQueue, dbx.appliedOps, dbx.meta],
    async () => {
      await Promise.all([
        dbx.products.clear(), dbx.goodsReceipts.clear(), dbx.stockMoves.clear(),
        dbx.suppliers.clear(), dbx.supplierPayments.clear(), dbx.purchaseOrders.clear(),
        dbx.batches.clear(), dbx.priceLog.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
      ])
    },
  )
  await initSyncEngine()
})

describe('parseQty rưỡi / chục', () => {
  it('hiểu rưỡi và chục', () => {
    expect(parseQty(['rưỡi'])).toEqual({ qty: 0.5, consumed: 1 })
    expect(parseQty(['chục'])).toEqual({ qty: 10, consumed: 1 })
    expect(parseQty(['hai', 'rưỡi'])).toEqual({ qty: 2.5, consumed: 2 })
    expect(parseQty(['một', 'chục'])).toEqual({ qty: 10, consumed: 2 })
  })

  it('parse câu có rưỡi', () => {
    expect(parseCommand('rưỡi kg đường')).toEqual([{ name: 'đường', qty: 0.5, unit: 'kg' }])
  })
})

describe('supplierMonthlyStatement', () => {
  it('cộng nhập và trả trong tháng', () => {
    const receipts: GoodsReceipt[] = [
      { id: 'g1', code: 'NK1', supplier: 'A', supplierId: 's1', date: '2026-08-02', expiry: '', note: '', rows: [], total: 100000, paid: 20000, ts: 1 },
      { id: 'g2', code: 'NK2', supplier: 'A', supplierId: 's1', date: '2026-07-31', expiry: '', note: '', rows: [], total: 50000, paid: 0, ts: 2 },
    ]
    const pays: SupplierPayment[] = [
      { id: 'p1', supplierId: 's1', amount: 10000, date: '2026-08-10', note: '' },
    ]
    const st = supplierMonthlyStatement('s1', receipts, pays, '2026-08')
    expect(st.purchased).toBe(100000)
    expect(st.paidOnReceipts).toBe(20000)
    expect(st.extraPaid).toBe(10000)
    expect(st.receiptCount).toBe(1)
    expect(st.net).toBe(70000)
  })
})

describe('forecastToPoRows', () => {
  it('lấy dòng gợi ý > 0', () => {
    const products = [{ id: 'p1', name: 'Mì', unit: 'gói', cost: 3000 } as Product]
    const forecast: StockForecast[] = [
      { productId: 'p1', name: 'Mì', avgPerDay: 2, daysLeft: 3, suggestedQty: 20 },
      { productId: 'p2', name: 'X', avgPerDay: 1, daysLeft: 40, suggestedQty: 0 },
    ]
    expect(forecastToPoRows(forecast, products)).toEqual([
      { productId: 'p1', name: 'Mì', unit: 'gói', qty: 20, cost: 3000 },
    ])
  })
})

describe('reportToAoa', () => {
  it('có dòng tổng và top', () => {
    const sales: Sale[] = [{
      id: 's1', items: [{ productId: 'p1', name: 'Mì', qty: 2, price: 5000, cost: 3000, unit: 'gói', unitRatio: 1 }],
      total: 10000, profit: 4000, discount: 0, payMethod: 'cash', tendered: 10000, change: 0, debtAmount: 0,
      customerId: null, date: '2026-08-16T08:00:00.000Z',
    }]
    const products = [{ id: 'p1', name: 'Mì', cat: 'Khô' } as Product]
    const f: ReportFilters = { preset: 'custom', from: '2026-08-01', to: '2026-08-31', metric: 'revenue', cat: 'all', pay: 'all', customerId: null, compare: false }
    const aoa = reportToAoa(buildReport(sales, products, f))
    expect(aoa[0][1]).toBe('2026-08-01')
    expect(aoa.some((row) => row.includes('Mì'))).toBe(true)
  })
})

describe('catalogRowIssues', () => {
  it('báo dòng thiếu tên', () => {
    const issues = catalogRowIssues([
      ['Mã hàng', 'Tên hàng'],
      ['ABC', ''],
      ['', 'Gạo'],
    ])
    expect(issues).toEqual([{ row: 2, message: 'Thiếu tên hàng' }])
  })
})

describe('reconcile explain', () => {
  it('giải thích lệch tồn / nợ', () => {
    expect(explainStockDrift({ productId: 'p', name: 'Mì', stock: 12, ledger: 10, drift: 2 })).toMatch(/nhiều hơn sổ/)
    expect(explainDebtDrift({ customerId: 'c', name: 'A', debt: 0, ledger: 5000, drift: -5000 })).toMatch(/thấp hơn sổ/)
  })
})

describe('lastPurchaseCost', () => {
  it('lấy vốn mới nhất', () => {
    const logs: PriceLogEntry[] = [
      { id: 'a', productId: 'p1', supId: 's', supName: 'S', cost: 1000, ts: 1 },
      { id: 'b', productId: 'p1', supId: 's', supName: 'S', cost: 1200, ts: 9 },
    ]
    expect(lastPurchaseCost(logs, 'p1')).toBe(1200)
    expect(lastPurchaseCost(logs, 'p2')).toBeNull()
  })
})

describe('receivePurchaseOrder từng phần', () => {
  it('nhận một phần rồi phần còn lại', async () => {
    const p: Product = {
      id: 'p1', name: 'Mì', cat: 'Khô', price: 5000, cost: 3000, stock: 10, unit: 'gói',
      barcode: '', expiry: '', units: [], wholesalePrice: 0, batches: [], createdAt: 1, updatedAt: 1,
    }
    await dbx.products.add(p)
    const po = await createPurchaseOrder({
      supplierId: 's1',
      supplierName: 'NCC',
      rows: [{ productId: 'p1', name: 'Mì', unit: 'gói', qty: 10, cost: 3000 }],
    })
    await receivePurchaseOrder(po.id, { qtys: { p1: 4 }, payMethod: 'debt' })
    const mid = await dbx.purchaseOrders.get(po.id)
    expect(mid?.status).toBe('ordered')
    expect(mid?.rows[0].receivedQty).toBe(4)
    expect((await dbx.products.get('p1'))?.stock).toBe(14)

    await receivePurchaseOrder(po.id, { payMethod: 'debt' })
    const done = await dbx.purchaseOrders.get(po.id)
    expect(done?.status).toBe('received')
    expect(done?.rows[0].receivedQty).toBe(10)
    expect((await dbx.products.get('p1'))?.stock).toBe(20)
  })
})
