/**
 * 3SU Next — Test logic miền (domain)
 *
 * Bao phủ các hàm quan trọng nhất:
 *  - Định dạng tiếng Việt (format)
 *  - Giá giỏ hàng / gợi ý đơn vị / giá bán (sales)
 *  - Chốt đơn (confirmSale): tính lại giá, trừ kho, ghi nợ — atomic
 *  - Hủy đơn (voidSale): hoàn kho, hoàn nợ
 *  - Nhập kho (saveGoodsReceipt): giá vốn bình quân gia quyền
 *  - Kiểm kê (saveStocktake): điều chỉnh tồn
 *  - Dự báo tồn kho (forecastStock)
 *
 * Chạy: `npm run test`
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import {
  confirmSale, voidSale, cartUnitPrice, dayStats, totalDebt,
  suggestUnits, bestSellerIds,
} from '@/core/domain/sales'
import {
  saveGoodsReceipt, suggestSellPrice, saveStocktake, forecastStock, selectStocktakeRows,
} from '@/core/domain/inventory'
import { fmt, fmtShort, fmtNum, normalizeVi, matchesSearch, today } from '@/core/format'
import type { Product, Customer, Sale } from '@/core/types'
import { initSyncEngine } from '@/core/sync/engine'

/* ─── Factories ─── */
let seq = 0
function mkProduct(over: Partial<Product> = {}): Product {
  seq += 1
  return {
    id: 'p' + seq,
    name: 'Sản phẩm ' + seq,
    cat: 'Khác',
    price: 5000,
    cost: 3000,
    stock: 100,
    unit: 'cái',
    barcode: '',
    expiry: '',
    units: [],
    wholesalePrice: 0,
    batches: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...over,
  }
}

function mkCustomer(over: Partial<Customer> = {}): Customer {
  seq += 1
  return {
    id: 'c' + seq,
    name: 'Khách ' + seq,
    phone: '',
    note: '',
    debt: 0,
    totalSpent: 0,
    orderCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...over,
  }
}

function mkSale(productId: string, qty: number, daysBack = 0): Sale {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  seq += 1
  return {
    id: 's' + seq,
    items: [{ productId, name: 'x', qty, price: 5000, cost: 3000, unit: 'cái', unitRatio: 1 }],
    total: qty * 5000,
    profit: qty * 2000,
    discount: 0,
    payMethod: 'cash',
    tendered: qty * 5000,
    change: 0,
    debtAmount: 0,
    customerId: null,
    date: d.toISOString(),
  }
}

/* Dọn DB trước mỗi test */
beforeEach(async () => {
  await dbx.transaction(
    'rw',
    [dbx.products, dbx.sales, dbx.customers, dbx.stockMoves, dbx.goodsReceipts, dbx.stocktakes, dbx.debtPayments, dbx.syncQueue, dbx.appliedOps, dbx.meta],
    async () => {
      await Promise.all([
        dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
        dbx.stockMoves.clear(), dbx.goodsReceipts.clear(), dbx.stocktakes.clear(),
        dbx.debtPayments.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
      ])
    },
  )
  await initSyncEngine()
})

/* ─── Định dạng ─── */
describe('format (tiếng Việt)', () => {
  it('fmt: tiền tệ đầy đủ', () => {
    expect(fmt(1234567)).toBe('1.234.567đ')
    expect(fmt(0)).toBe('0đ')
  })

  it('fmtShort: tiền ngắn gọn', () => {
    expect(fmtShort(1200000)).toBe('1,2tr')
    expect(fmtShort(45000)).toBe('45k')
    expect(fmtShort(2500000000)).toBe('2,5tỷ')
  })

  it('fmtNum: số có phân cách', () => {
    expect(fmtNum(1234)).toBe('1.234')
  })

  it('normalizeVi + matchesSearch: tìm không dấu', () => {
    expect(normalizeVi('Cà Phê Sữa')).toBe('ca phe sua')
    expect(matchesSearch('Cà Phê Sữa', 'ca phe')).toBe(true)
    expect(matchesSearch('Cà Phê Sữa', 'trà')).toBe(false)
  })
})

/* ─── Giá giỏ hàng ─── */
describe('cartUnitPrice', () => {
  const p = mkProduct({ price: 5000, wholesalePrice: 4000 })

  it('giá lẻ, đơn vị gốc', () => {
    expect(cartUnitPrice({ productId: p.id, qty: 1, unitName: 'cái', unitRatio: 1 }, p, false)).toBe(5000)
  })

  it('giá sỉ khi có wholesalePrice', () => {
    expect(cartUnitPrice({ productId: p.id, qty: 1, unitName: 'cái', unitRatio: 1 }, p, true)).toBe(4000)
  })

  it('sỉ nhưng chưa có giá sỉ → về giá lẻ', () => {
    const p2 = mkProduct({ price: 5000, wholesalePrice: 0 })
    expect(cartUnitPrice({ productId: p2.id, qty: 1, unitName: 'cái', unitRatio: 1 }, p2, true)).toBe(5000)
  })

  it('nhân hệ số đơn vị (thùng = 24)', () => {
    expect(cartUnitPrice({ productId: p.id, qty: 1, unitName: 'thùng', unitRatio: 24 }, p, false)).toBe(120000)
  })
})

/* ─── Gợi ý đơn vị ─── */
describe('suggestUnits', () => {
  it('nhận diện nước ngọt theo tên', () => {
    const u = suggestUnits(mkProduct({ name: 'Coca Cola', unit: 'chai' }))
    expect(u.map((x) => x.n)).toEqual(['chai', 'lốc', 'thùng'])
  })

  it('ưu tiên đơn vị tuỳ chỉnh của sản phẩm', () => {
    const p = mkProduct({ unit: 'cái', units: [{ n: 'lốc', r: 6 }] })
    const u = suggestUnits(p)
    expect(u[0]).toEqual({ n: 'cái', r: 1 })
    expect(u[1]).toEqual({ n: 'lốc', r: 6 })
  })

  it('sản phẩm thường → chỉ đơn vị gốc', () => {
    const u = suggestUnits(mkProduct({ name: 'Đinh ốc', unit: 'con' }))
    expect(u).toEqual([{ n: 'con', r: 1 }])
  })
})

/* ─── Gợi ý giá bán ─── */
describe('suggestSellPrice', () => {
  it('gợi ý margin 20% khi chưa có giá', () => {
    expect(suggestSellPrice(10000, 0)).toEqual({ price: 12000, margin: 20 })
  })

  it('giá hiện tại đã ổn → không gợi ý', () => {
    expect(suggestSellPrice(10000, 15000)).toBeNull()
  })

  it('giá vốn 0 → không gợi ý', () => {
    expect(suggestSellPrice(0, 5000)).toBeNull()
  })
})

/* ─── Chốt đơn (atomic) ─── */
describe('confirmSale', () => {
  it('tính lại giá, trừ kho, ghi đơn + stock move', async () => {
    const p = mkProduct({ price: 5000, cost: 3000, stock: 100 })
    await dbx.products.add(p)

    const { sale, warnings } = await confirmSale({
      items: [{ productId: p.id, qty: 2, unitName: 'cái', unitRatio: 1 }],
      products: [p],
      discount: 0,
      payMethod: 'cash',
      tendered: 20000,
      customerId: null,
      wholesale: false,
    })

    expect(sale.total).toBe(10000)      // 5000 * 2 — tính lại từ product
    expect(sale.profit).toBe(4000)      // (5000-3000) * 2
    expect(sale.change).toBe(10000)     // 20000 - 10000
    expect(sale.debtAmount).toBe(0)
    expect(warnings).toEqual([])

    const after = await dbx.products.get(p.id)
    expect(after?.stock).toBe(98)       // trừ kho

    const moves = await dbx.stockMoves.toArray()
    expect(moves).toHaveLength(1)
    expect(moves[0].type).toBe('sale')
    expect(moves[0].qty).toBe(-2)
  })

  it('ghi nợ khi đưa thiếu tiền (có khách)', async () => {
    const p = mkProduct({ price: 5000, cost: 3000, stock: 100 })
    const c = mkCustomer({ debt: 0 })
    await dbx.products.add(p)
    await dbx.customers.add(c)

    const { sale } = await confirmSale({
      items: [{ productId: p.id, qty: 2, unitName: 'cái', unitRatio: 1 }],
      products: [p],
      discount: 0,
      payMethod: 'cash',
      tendered: 5000,                   // thiếu 5000
      customerId: c.id,
      wholesale: false,
    })

    expect(sale.debtAmount).toBe(5000)
    const after = await dbx.customers.get(c.id)
    expect(after?.debt).toBe(5000)
    expect(after?.totalSpent).toBe(10000)
    expect(after?.orderCount).toBe(1)
  })

  it('ném lỗi khi ghi nợ mà không chọn khách', async () => {
    const p = mkProduct({ price: 5000, stock: 100 })
    await dbx.products.add(p)

    await expect(confirmSale({
      items: [{ productId: p.id, qty: 2, unitName: 'cái', unitRatio: 1 }],
      products: [p],
      discount: 0,
      payMethod: 'cash',
      tendered: 5000,
      customerId: null,                 // không có khách
      wholesale: false,
    })).rejects.toThrow(/khách hàng/i)
  })

  it('cảnh báo âm kho nhưng vẫn cho bán khi allowNegativeStock', async () => {
    const p = mkProduct({ price: 5000, stock: 1 })
    await dbx.products.add(p)
    await dbx.meta.put({ key: 'settings', value: { allowNegativeStock: true } })

    const { warnings } = await confirmSale({
      items: [{ productId: p.id, qty: 5, unitName: 'cái', unitRatio: 1 }],
      products: [p],
      discount: 0,
      payMethod: 'cash',
      tendered: 100000,
      customerId: null,
      wholesale: false,
    })

    expect(warnings.some((w) => /âm kho/.test(w))).toBe(true)
    const after = await dbx.products.get(p.id)
    expect(after?.stock).toBe(-4)
  })

  it('chặn bán âm kho khi allowNegativeStock = false', async () => {
    const p = mkProduct({ price: 5000, stock: 1 })
    await dbx.products.add(p)
    await dbx.meta.put({ key: 'settings', value: { allowNegativeStock: false } })

    await expect(confirmSale({
      items: [{ productId: p.id, qty: 5, unitName: 'cái', unitRatio: 1 }],
      products: [p],
      discount: 0,
      payMethod: 'cash',
      tendered: 100000,
      customerId: null,
      wholesale: false,
    })).rejects.toThrow(/không đủ tồn/)
    expect((await dbx.products.get(p.id))?.stock).toBe(1)
    expect(await dbx.sales.count()).toBe(0)
  })

  it('tính tiền từ Dexie, không tin giá trên UI', async () => {
    const p = mkProduct({ price: 5000, cost: 3000, stock: 10 })
    await dbx.products.add(p)
    const stale = { ...p, price: 1 }

    const { sale } = await confirmSale({
      items: [{ productId: p.id, qty: 1, unitName: 'cái', unitRatio: 1 }],
      products: [stale],
      discount: 0,
      payMethod: 'cash',
      tendered: 5000,
      customerId: null,
      wholesale: false,
    })
    expect(sale.total).toBe(5000)
  })
})

/* ─── Hủy đơn ─── */
describe('voidSale', () => {
  it('hoàn kho và đánh dấu hủy', async () => {
    const p = mkProduct({ price: 5000, cost: 3000, stock: 100 })
    await dbx.products.add(p)

    const { sale } = await confirmSale({
      items: [{ productId: p.id, qty: 2, unitName: 'cái', unitRatio: 1 }],
      products: [p],
      discount: 0,
      payMethod: 'cash',
      tendered: 20000,
      customerId: null,
      wholesale: false,
    })
    expect((await dbx.products.get(p.id))?.stock).toBe(98)

    await voidSale(sale.id, 'khách đổi ý')

    expect((await dbx.products.get(p.id))?.stock).toBe(100)  // hoàn kho
    const voided = await dbx.sales.get(sale.id)
    expect(voided?.voided).toBe(true)
    expect(voided?.voidReason).toBe('khách đổi ý')

    const moves = await dbx.stockMoves.toArray()
    expect(moves.some((m) => m.type === 'void_restore' && m.qty === 2)).toBe(true)
  })

  it('hoàn nợ khách khi hủy đơn ghi nợ', async () => {
    const p = mkProduct({ price: 5000, stock: 100 })
    const c = mkCustomer({ debt: 0 })
    await dbx.products.add(p)
    await dbx.customers.add(c)

    const { sale } = await confirmSale({
      items: [{ productId: p.id, qty: 2, unitName: 'cái', unitRatio: 1 }],
      products: [p],
      discount: 0,
      payMethod: 'cash',
      tendered: 5000,
      customerId: c.id,
      wholesale: false,
    })
    expect((await dbx.customers.get(c.id))?.debt).toBe(5000)

    await voidSale(sale.id, 'hủy')
    const after = await dbx.customers.get(c.id)
    expect(after?.debt).toBe(0)
    expect(after?.orderCount).toBe(0)
  })

  it('từ chối hủy khi chưa nhập lý do', async () => {
    const p = mkProduct({ stock: 10 })
    await dbx.products.add(p)
    const { sale } = await confirmSale({
      items: [{ productId: p.id, qty: 1, unitName: 'cái', unitRatio: 1 }],
      products: [p],
      discount: 0,
      payMethod: 'cash',
      tendered: 5000,
      customerId: null,
      wholesale: false,
    })
    await expect(voidSale(sale.id, '   ')).rejects.toThrow('Nhập lý do hủy đơn')
    expect((await dbx.sales.get(sale.id))?.voided).toBeFalsy()
  })
})

/* ─── Nhập kho: giá vốn bình quân gia quyền ─── */
describe('saveGoodsReceipt', () => {
  it('tính giá vốn bình quân gia quyền', async () => {
    const p = mkProduct({ stock: 10, cost: 1000 })
    await dbx.products.add(p)

    const gr = await saveGoodsReceipt({
      supplier: 'NCC A',
      date: '2026-07-30',
      expiry: '',
      note: '',
      rows: [{ productId: p.id, name: p.name, unit: 'cái', qty: 10, cost: 2000 }],
    })

    // cost = (10*1000 + 10*2000) / 20 = 1500
    const after = await dbx.products.get(p.id)
    expect(after?.stock).toBe(20)
    expect(after?.cost).toBe(1500)
    expect(gr.total).toBe(20000)        // 10 * 2000

    const moves = await dbx.stockMoves.toArray()
    expect(moves.some((m) => m.type === 'purchase' && m.qty === 10)).toBe(true)
  })

  it('kho rỗng → nhận giá nhập làm giá vốn', async () => {
    const p = mkProduct({ stock: 0, cost: 0 })
    await dbx.products.add(p)

    await saveGoodsReceipt({
      supplier: 'NCC B', date: '2026-07-30', expiry: '', note: '',
      rows: [{ productId: p.id, name: p.name, unit: 'cái', qty: 5, cost: 3000 }],
    })

    const after = await dbx.products.get(p.id)
    expect(after?.stock).toBe(5)
    expect(after?.cost).toBe(3000)
  })
})

/* ─── Kiểm kê ─── */
describe('saveStocktake', () => {
  it('điều chỉnh tồn theo số thực tế', async () => {
    const p = mkProduct({ stock: 100, cost: 3000 })
    await dbx.products.add(p)

    const record = await saveStocktake(
      [{ productId: p.id, name: p.name, system: 100, actual: 95 }],
      'kiểm cuối tháng',
    )

    expect((await dbx.products.get(p.id))?.stock).toBe(95)
    expect(record.rows[0].diff).toBe(-5)

    const moves = await dbx.stockMoves.toArray()
    expect(moves.some((m) => m.type === 'stocktake' && m.qty === -5)).toBe(true)
  })

  it('bỏ qua dòng không chênh lệch', async () => {
    const p = mkProduct({ stock: 50 })
    await dbx.products.add(p)

    await saveStocktake(
      [{ productId: p.id, name: p.name, system: 50, actual: 50 }],
      '',
    )

    expect((await dbx.products.get(p.id))?.stock).toBe(50)
    expect(await dbx.stockMoves.count()).toBe(0)
  })
})

describe('selectStocktakeRows', () => {
  const rows = [
    { productId: 'p1', name: 'sữa', system: 18, actual: 18 },
    { productId: 'p2', name: 'nước', system: 10, actual: 9 },
  ]

  it('giữ dòng đã đếm dù thực tế = sổ sách', () => {
    const picked = selectStocktakeRows(rows, new Set(['p1']))
    expect(picked.map((r) => r.productId)).toEqual(['p1', 'p2'])
  })

  it('bỏ dòng không lệch và chưa đếm', () => {
    const picked = selectStocktakeRows(rows, new Set())
    expect(picked.map((r) => r.productId)).toEqual(['p2'])
  })
})

/* ─── Dự báo tồn kho ─── */
describe('forecastStock', () => {
  it('tính ngày hết hàng từ tốc độ bán 30 ngày', () => {
    const p = mkProduct({ stock: 10 })
    const sales = [mkSale(p.id, 30, 0)]   // bán 30 trong 30 ngày → 1/ngày

    const [f] = forecastStock([p], sales, 30)
    expect(f.avgPerDay).toBe(1)
    expect(f.daysLeft).toBe(10)
    expect(f.suggestedQty).toBe(4)        // ceil(1*14 - 10)
  })

  it('loại đơn đã hủy và đơn ngoài cửa sổ', () => {
    const p = mkProduct({ stock: 100 })
    const voided = { ...mkSale(p.id, 50, 0), voided: true }
    const tooOld = mkSale(p.id, 50, 60)   // 60 ngày trước → ngoài 30 ngày

    const result = forecastStock([p], [voided, tooOld], 30)
    expect(result).toHaveLength(0)        // không có doanh số hợp lệ
  })
})

/* ─── Thống kê ─── */
describe('dayStats & totalDebt', () => {
  it('dayStats tổng hợp doanh thu trong ngày', () => {
    const p = mkProduct()
    const sales = [mkSale(p.id, 2, 0), mkSale(p.id, 3, 0), mkSale(p.id, 9, 5)]
    const st = dayStats(sales, today())
    expect(st.orders).toBe(2)             // chỉ 2 đơn hôm nay
    expect(st.revenue).toBe(5 * 5000)     // (2+3) * 5000
  })

  it('totalDebt chỉ tính nợ dương, bỏ khách đã xóa', () => {
    const customers = [
      mkCustomer({ debt: 100 }),
      mkCustomer({ debt: -50 }),          // khách dư → không tính
      mkCustomer({ debt: 200 }),
      mkCustomer({ debt: 999, deleted: true }),
    ]
    expect(totalDebt(customers)).toBe(300)
  })

  it('bestSellerIds sắp xếp theo số lượng bán', () => {
    const a = mkProduct()
    const b = mkProduct()
    const sales = [
      { ...mkSale(a.id, 5, 0) },
      { ...mkSale(b.id, 20, 0) },
    ]
    expect(bestSellerIds(sales)[0]).toBe(b.id)
  })
})
