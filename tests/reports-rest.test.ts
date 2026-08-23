import { describe, it, expect } from 'vitest'
import { aggregatePurchases } from '@/core/domain/purchase'
import { customerDebtToAoa, reportSalesWindow, resolveRange } from '@/core/domain/reports'
import { compareSupplierPrices } from '@/core/domain/suppliers'
import { topProducts } from '@/core/browser/quickAnswers'
import { today, vnToday } from '@/core/format'
import type { Customer, GoodsReceipt, PurchaseOrder, Sale, Supplier } from '@/core/types'

describe('M5 — PO received không đứng cạnh GR', () => {
  it('một GR + PO received cùng tiền → một dòng gr', () => {
    const gr = {
      id: 'g1', code: 'NK-1', supplier: 'A', date: '2026-08-18', ts: 1,
      total: 100, paid: 0, note: '', rows: [1],
    }
    const po: PurchaseOrder = {
      id: 'po1', code: 'PO-1', supplierId: 'sa', supplierName: 'A', date: '2026-08-18', ts: 1,
      rows: [], total: 100, status: 'received', note: '',
    }
    const rows = aggregatePurchases([gr], [po])
    expect(rows.map((r) => r.kind)).toEqual(['gr'])
  })
})

describe('M6 — MTD / YTD theo giờ VN', () => {
  it('from = ngày 1 tháng local của today()', () => {
    const { from, to } = resolveRange({
      preset: 'mtd', from: '', to: '', metric: 'revenue',
      cat: '', pay: '', customerId: null, compare: false,
    })
    expect(from).toBe(today().slice(0, 8) + '01')
    expect(to).toBe(today())
  })

  it('YTD lấy năm theo lịch VN', () => {
    const { from } = resolveRange({
      preset: 'ytd', from: '', to: '', metric: 'revenue',
      cat: '', pay: '', customerId: null, compare: false,
    })
    expect(from).toBe(vnToday().slice(0, 4) + '-01-01')
  })

  it('compare nới cửa sổ về kỳ trước', () => {
    const w = reportSalesWindow({
      preset: '7', from: '', to: '', metric: 'revenue',
      cat: '', pay: '', customerId: null, compare: true,
    })
    const cur = resolveRange({
      preset: '7', from: '', to: '', metric: 'revenue',
      cat: '', pay: '', customerId: null, compare: true,
    })
    expect(w.to).toBe(cur.to)
    expect(w.from < cur.from).toBe(true)
  })

  it('topProducts nhân unitRatio', () => {
    const sales: Sale[] = [{
      id: 's1',
      items: [{ productId: 'p1', name: 'Sting', qty: 1, price: 24000, cost: 18000, unit: 'thùng', unitRatio: 24 }],
      total: 24000, profit: 6000, discount: 0, payMethod: 'cash',
      tendered: 24000, change: 0, debtAmount: 0, customerId: null,
      date: today() + 'T10:00:00',
    }]
    expect(topProducts(sales, today(), 3)[0]?.qty).toBe(24)
  })
})

describe('xuất công nợ KH', () => {
  it('chỉ khách còn nợ, sắp xếp giảm dần', () => {
    const customers: Customer[] = [
      { id: 'a', name: 'An', phone: '1', note: '', debt: 100, totalSpent: 0, orderCount: 0, createdAt: 1, updatedAt: 1 },
      { id: 'b', name: 'Bình', phone: '2', note: '', debt: 0, totalSpent: 0, orderCount: 0, createdAt: 1, updatedAt: 1 },
      { id: 'c', name: 'Cúc', phone: '3', note: '', debt: 500, totalSpent: 0, orderCount: 0, createdAt: 1, updatedAt: 1 },
    ]
    const aoa = customerDebtToAoa(customers)
    expect(aoa[1]).toEqual(['Cúc', '3', 500])
    expect(aoa[2]).toEqual(['An', '1', 100])
    expect(aoa.at(-1)?.[2]).toBe(600)
  })
})

describe('M7 — so giá theo đơn vị gốc', () => {
  it('thùng 24 × cost 24000 rẻ hơn lẻ cost 1200', () => {
    const receipts: GoodsReceipt[] = [
      {
        id: 'a', code: '1', supplier: 'A', supplierId: 'sa', date: '2026-08-01',
        expiry: '', note: '', total: 24000, ts: 1, rows: [{
          productId: 'p1', name: 'Sting', unit: 'thùng', unitRatio: 24, qty: 1, cost: 24000, expiry: '',
        }],
      },
      {
        id: 'b', code: '2', supplier: 'B', supplierId: 'sb', date: '2026-08-02',
        expiry: '', note: '', total: 1200, ts: 2, rows: [{
          productId: 'p1', name: 'Sting', unit: 'lon', unitRatio: 1, qty: 1, cost: 1200, expiry: '',
        }],
      },
    ]
    const suppliers: Supplier[] = [
      { id: 'sa', name: 'A', phone: '', address: '', note: '', leadDays: 0, debt: 0, totalPurchased: 0, orderCount: 0, createdAt: 1, updatedAt: 1 },
      { id: 'sb', name: 'B', phone: '', address: '', note: '', leadDays: 0, debt: 0, totalPurchased: 0, orderCount: 0, createdAt: 1, updatedAt: 1 },
    ]
    const out = compareSupplierPrices(receipts, suppliers)
    expect(out[0]!.bestSupplierId).toBe('sa')
    expect(out[0]!.bestCost).toBe(1000) // 24000/24
    expect(out[0]!.currentCost).toBe(1200)
  })
})
