import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import { salesInDateRange, effectiveCashTendered } from '@/core/domain/sales'
import { addCustomer, deleteCustomer, payDebt } from '@/core/domain/customers'
import { deleteProduct } from '@/core/domain/inventory'
import { prevCalendarDay, vnDay } from '@/core/format'
import { buildReport } from '@/core/domain/reports'
import type { Product, Sale } from '@/core/types'

function mkSale(id: string, dateIso: string, total = 10_000): Sale {
  return {
    id,
    items: [{ productId: 'p1', name: 'SP', qty: 1, price: total, cost: 4000, unit: 'cái', unitRatio: 1 }],
    total,
    profit: total - 4000,
    discount: 0,
    payMethod: 'cash',
    tendered: total,
    change: 0,
    debtAmount: 0,
    customerId: null,
    date: dateIso,
  }
}

describe('prevCalendarDay + salesInDateRange (đơn sáng sớm VN)', () => {
  beforeEach(async () => {
    await dbx.sales.clear()
  })

  it('lùi YYYY-MM-DD một ngày lịch, kể cả qua tháng', () => {
    expect(prevCalendarDay('2026-08-26')).toBe('2026-08-25')
    expect(prevCalendarDay('2026-03-01')).toBe('2026-02-28')
  })

  it('đơn 05:00 VN (UTC hôm trước) vẫn vào cửa sổ cùng ngày VN', async () => {
    // 2026-08-26 05:00 ICT = 2026-08-25T22:00:00.000Z
    const dawn = mkSale('s-dawn', '2026-08-25T22:00:00.000Z', 15_000)
    const morning = mkSale('s-am', '2026-08-26T00:30:00.000Z', 20_000)
    await dbx.sales.bulkPut([dawn, morning])

    const rows = await salesInDateRange('2026-08-26', '2026-08-26')
    expect(rows.map((s) => s.id).sort()).toEqual(['s-am', 's-dawn'])
    expect(vnDay(dawn.date)).toBe('2026-08-26')
  })

  it('báo cáo custom một ngày VN gồm đơn 00:00–06:59', async () => {
    const dawn = mkSale('s-dawn', '2026-08-25T22:00:00.000Z', 15_000)
    await dbx.sales.add(dawn)
    const products: Product[] = []
    const loaded = await salesInDateRange('2026-08-26', '2026-08-26')
    const report = buildReport(loaded, products, {
      preset: 'custom',
      from: '2026-08-26',
      to: '2026-08-26',
      metric: 'revenue',
      cat: 'all',
      pay: 'all',
      customerId: null,
      compare: false,
    })
    expect(report.revenue).toBe(15_000)
    expect(report.orders).toBe(1)
  })
})

describe('effectiveCashTendered — ô trống không phải đủ tiền', () => {
  it('tiền mặt chưa nhập → chặn chốt', () => {
    const r = effectiveCashTendered({ payMethod: 'cash', total: 20_000, tendered: 0, cashEntered: false })
    expect(r.needsCashEntry).toBe(true)
    expect(r.tendered).toBe(0)
    expect(r.debtAmount).toBe(0)
  })

  it('bấm Đủ → tendered = tổng, không nợ', () => {
    const r = effectiveCashTendered({ payMethod: 'cash', total: 20_000, tendered: 20_000, cashEntered: true })
    expect(r.needsCashEntry).toBe(false)
    expect(r.tendered).toBe(20_000)
    expect(r.debtAmount).toBe(0)
    expect(r.change).toBe(0)
  })

  it('nhập thiếu → ghi nợ phần còn', () => {
    const r = effectiveCashTendered({ payMethod: 'cash', total: 20_000, tendered: 5_000, cashEntered: true })
    expect(r.debtAmount).toBe(15_000)
  })
})

describe('guard xóa khách / sản phẩm', () => {
  beforeEach(async () => {
    await Promise.all([dbx.customers.clear(), dbx.products.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.users.clear(), dbx.meta.clear()])
    await initSyncEngine()
  })

  it('thu vượt nợ vẫn throw', async () => {
    const c = await addCustomer({ name: 'Nợ', phone: '', note: '', wholesale: false })
    await dbx.customers.update(c.id, { debt: 5_000 })
    await expect(payDebt(c.id, 6_000)).rejects.toThrow(/vượt công nợ/)
    expect((await dbx.customers.get(c.id))!.debt).toBe(5_000)
  })

  it('không xóa khách còn nợ', async () => {
    const c = await addCustomer({ name: 'Nợ', phone: '', note: '', wholesale: false })
    await dbx.customers.update(c.id, { debt: 12_000 })
    await expect(deleteCustomer(c.id)).rejects.toThrow(/còn nợ/)
    expect((await dbx.customers.get(c.id))!.deleted).toBeFalsy()
  })

  it('không xóa sản phẩm còn tồn', async () => {
    await dbx.products.add({
      id: 'p-stock', name: 'Còn hàng', cat: 'Khác', price: 1000, cost: 500,
      stock: 4, unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0,
      batches: [], createdAt: 1, updatedAt: 1,
    })
    await expect(deleteProduct('p-stock')).rejects.toThrow(/Còn tồn/)
    expect((await dbx.products.get('p-stock'))!.deleted).toBeFalsy()
  })
})
