import { describe, expect, it } from 'vitest'
import { buildReport, type ReportFilters } from '@/core/domain/reports'
import type { Product, Sale, SaleItem } from '@/core/types'

function product(id: string, name: string, cat: string): Product {
  return {
    id,
    name,
    cat,
    price: 0,
    cost: 0,
    stock: 0,
    unit: 'cái',
    barcode: '',
    expiry: '',
    units: [],
    wholesalePrice: 0,
    batches: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function sale(over: Partial<Sale> & { id: string; date: string; items: SaleItem[] }): Sale {
  return {
    total: 0,
    profit: 0,
    discount: 0,
    payMethod: 'cash',
    tendered: 0,
    change: 0,
    debtAmount: 0,
    customerId: null,
    ...over,
  }
}

function filters(over: Partial<ReportFilters> = {}): ReportFilters {
  return {
    preset: 'custom',
    from: '2026-08-10',
    to: '2026-08-10',
    metric: 'revenue',
    cat: 'all',
    pay: 'all',
    customerId: null,
    compare: false,
    ...over,
  }
}

const products = [
  product('p-food', 'Mì', 'Thực phẩm'),
  product('p-home', 'Nước giặt', 'Gia dụng'),
]

const discountedSale = sale({
  id: 's-discount',
  date: '2026-08-10T10:00:00+07:00',
  items: [
    { productId: 'p-food', name: 'Mì', qty: 1, price: 100, cost: 50, unit: 'gói', unitRatio: 1 },
    { productId: 'p-home', name: 'Nước giặt', qty: 1, price: 900, cost: 400, unit: 'chai', unitRatio: 1 },
  ],
  total: 900,
  profit: 450,
  discount: 100,
  payMethod: 'cash',
  tendered: 900,
})

describe('line-level category and discount allocation', () => {
  it('lọc danh mục chỉ lấy dòng thuộc danh mục và phần discount tương ứng', () => {
    const report = buildReport([discountedSale], products, filters({ cat: 'Thực phẩm' }))

    expect(report.revenue).toBe(90)
    expect(report.profit).toBe(40)
    expect(report.orders).toBe(1)
    expect(report.items).toBe(1)
    expect(report.topProducts).toEqual([{
      productId: 'p-food', name: 'Mì', qty: 1, revenue: 90, profit: 40,
    }])
    expect(report.topCategories).toEqual([{
      cat: 'Thực phẩm', revenue: 90, profit: 40,
    }])
    expect(report.payBreakdown).toEqual([{
      method: 'Tiền mặt', count: 1, amount: 90,
    }])
  })

  it('tổng sản phẩm và danh mục khớp headline sau phân bổ discount', () => {
    const report = buildReport([discountedSale], products, filters())

    expect(report.topProducts.reduce((sum, row) => sum + row.revenue, 0)).toBe(report.revenue)
    expect(report.topProducts.reduce((sum, row) => sum + row.profit, 0)).toBe(report.profit)
    expect(report.topCategories.reduce((sum, row) => sum + row.revenue, 0)).toBe(report.revenue)
    expect(report.topCategories.reduce((sum, row) => sum + row.profit, 0)).toBe(report.profit)
    expect(report.daily.reduce((sum, row) => sum + row.revenue, 0)).toBe(report.revenue)
  })
})

describe('base quantity and mixed payment ledger', () => {
  it('đếm số lượng theo đơn vị gốc', () => {
    const packageSale = sale({
      id: 's-package',
      date: '2026-08-10T12:00:00+07:00',
      items: [{
        productId: 'p-food', name: 'Mì', qty: 2,
        price: 2_400, cost: 1_200, unit: 'thùng', unitRatio: 24,
      }],
      total: 4_800,
      profit: 2_400,
      payMethod: 'transfer',
      tendered: 4_800,
    })

    const report = buildReport([packageSale], products, filters())
    expect(report.items).toBe(48)
    expect(report.topProducts[0]?.qty).toBe(48)
  })

  it('tách phần thực thu tiền mặt và phần công nợ của cùng một đơn', () => {
    const mixed = sale({
      id: 's-mixed',
      date: '2026-08-10T13:00:00+07:00',
      items: [{
        productId: 'p-food', name: 'Mì', qty: 1,
        price: 100, cost: 60, unit: 'gói', unitRatio: 1,
      }],
      total: 100,
      profit: 40,
      payMethod: 'cash',
      tendered: 60,
      debtAmount: 40,
      customerId: 'c1',
    })

    const report = buildReport([mixed], products, filters())
    expect(report.payBreakdown).toEqual([
      { method: 'Tiền mặt', count: 1, amount: 60 },
      { method: 'Ghi nợ', count: 1, amount: 40 },
    ])
    expect(report.payBreakdown.reduce((sum, row) => sum + row.amount, 0)).toBe(report.revenue)

    const debtFiltered = buildReport([mixed], products, filters({ pay: 'debt' }))
    expect(debtFiltered.orders).toBe(1)
    expect(debtFiltered.revenue).toBe(100)
  })
})

describe('previous period uses the same filters', () => {
  it('áp lại category, payment và customer cho kỳ trước', () => {
    const current = sale({
      id: 'current',
      date: '2026-08-10T10:00:00+07:00',
      items: [{ productId: 'p-food', name: 'Mì', qty: 1, price: 100, cost: 50, unit: 'gói', unitRatio: 1 }],
      total: 100,
      profit: 50,
      payMethod: 'debt',
      debtAmount: 100,
      customerId: 'c1',
    })
    const previousMatch = sale({
      id: 'previous-match',
      date: '2026-08-09T10:00:00+07:00',
      items: [{ productId: 'p-food', name: 'Mì', qty: 1, price: 80, cost: 40, unit: 'gói', unitRatio: 1 }],
      total: 80,
      profit: 40,
      payMethod: 'debt',
      debtAmount: 80,
      customerId: 'c1',
    })
    const previousWrongCustomer = sale({
      id: 'previous-wrong-customer',
      date: '2026-08-09T11:00:00+07:00',
      items: [{ productId: 'p-food', name: 'Mì', qty: 1, price: 500, cost: 10, unit: 'gói', unitRatio: 1 }],
      total: 500,
      profit: 490,
      payMethod: 'debt',
      debtAmount: 500,
      customerId: 'c2',
    })
    const previousWrongCategory = sale({
      id: 'previous-wrong-category',
      date: '2026-08-09T12:00:00+07:00',
      items: [{ productId: 'p-home', name: 'Nước giặt', qty: 1, price: 900, cost: 400, unit: 'chai', unitRatio: 1 }],
      total: 900,
      profit: 500,
      payMethod: 'debt',
      debtAmount: 900,
      customerId: 'c1',
    })

    const report = buildReport(
      [current, previousMatch, previousWrongCustomer, previousWrongCategory],
      products,
      filters({ cat: 'Thực phẩm', pay: 'debt', customerId: 'c1', compare: true }),
    )

    expect(report.revenue).toBe(100)
    expect(report.prev).toEqual({ revenue: 80, profit: 40, orders: 1 })
  })
})
