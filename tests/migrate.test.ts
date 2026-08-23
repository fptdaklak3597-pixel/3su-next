import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { checksumOf, importLegacy, previewLegacy } from '@/core/domain/migrate'

describe('migrate 3SU cũ', () => {
  beforeEach(async () => {
    await dbx.products.clear()
    await dbx.sales.clear()
    await dbx.customers.clear()
    await dbx.goodsReceipts.clear()
    await dbx.debtPayments.clear()
  })

  it('previewLegacy đọc file cũ (payments + grLogs) và checksum tồn/nợ', () => {
    const { data, checksum } = previewLegacy({
      shop: { name: 'Tạp hoá A', phone: '090', address: '' },
      settings: { receipt: { transferQrNote: 'VCB 111', thankYou: 'Cám ơn' }, printer: { width: 80 } },
      products: [{ id: 'p1', name: 'Sữa', stock: 10, price: 10000, cost: 8000 }],
      sales: [{ id: 's1', total: 10000, items: [{ productId: 'p1', name: 'Sữa', qty: 1, price: 10000 }] }],
      customers: [{ id: 'c1', name: 'Bác Hai', debt: 5000 }],
      payments: [{ id: 'pay1', customerId: 'c1', amount: 1000, date: '2026-01-01' }],
      grLogs: [{ id: 'g1', code: 'NK-1', sup: 'NCC', rows: [{ productId: 'p1', name: 'Sữa', qty: 2, cost: 8000 }], total: 16000 }],
    })
    expect(checksum).toEqual({ products: 1, sales: 1, customers: 1, stockSum: 10, debtSum: 5000 })
    expect(data.settings.transferQrNote).toBe('VCB 111')
    expect(data.settings.printer.width).toBe(80)
    expect(data.debtPayments).toHaveLength(1)
    expect(data.goodsReceipts[0].supplier).toBe('NCC')
    expect(data.goodsReceipts[0].code).toBe('NK-1')
    expect(data.products[0].unit).toBe('cái')
    expect(data.sales[0].items[0].unitRatio).toBe(1)
  })

  it('importLegacy ghi Dexie và checksum khớp', async () => {
    const { data, checksum } = previewLegacy({
      products: [{ id: 'p1', name: 'Sữa', stock: 3, price: 1, cost: 1 }],
      sales: [],
      customers: [{ id: 'c1', name: 'A', debt: 2000 }],
    })
    const after = await importLegacy(data)
    expect(after).toEqual(checksum)
    expect(await dbx.products.count()).toBe(1)
    expect((await dbx.products.get('p1'))?.stock).toBe(3)
    expect(checksumOf(data).debtSum).toBe(2000)
  })

  it('importLegacy xóa hàng đợi/cursor sync và tạm dừng cloud (nhánh dữ liệu mới)', async () => {
    await dbx.syncQueue.clear()
    await dbx.commandQueue.clear()
    await dbx.meta.clear()
    await dbx.syncQueue.put({ id: 'op_old', type: 'product.upsert', createdAt: 1 } as never)
    await dbx.commandQueue.put({ id: 'q_old', type: 'sale.create', createdAt: 1, status: 'pending' } as never)
    await dbx.meta.put({ key: 'sync:lastSeq', value: 42 })
    await dbx.meta.put({ key: 'cloud:shopId', value: 'shop_old' })

    const { data } = previewLegacy({
      products: [{ id: 'p1', name: 'Sữa', stock: 3, price: 1, cost: 1 }],
      sales: [],
      customers: [],
    })
    await importLegacy(data)

    expect(await dbx.syncQueue.count()).toBe(0)
    expect(await dbx.commandQueue.count()).toBe(0)
    expect(await dbx.meta.get('sync:lastSeq')).toBeUndefined()
    expect((await dbx.meta.get('cloud:paused'))?.value).toBe(true)
  })

  it('file thiếu products thì reject', () => {
    expect(() => previewLegacy({ sales: [], customers: [] })).toThrow(/products/)
  })
})
