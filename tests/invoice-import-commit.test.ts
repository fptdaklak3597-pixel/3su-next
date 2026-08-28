import { beforeEach, describe, expect, it } from 'vitest'
import { dbx, DEFAULT_SETTINGS } from '@/core/db'
import { commitInvoiceImport } from '@/core/domain/inventory'
import { initSyncEngine } from '@/core/sync/engine'
import type { Product } from '@/core/types'

function existing(): Product {
  return {
    id: 'p-old', name: 'SP cũ', cat: 'Khác', price: 10000, cost: 6000, stock: 0,
    unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: 1, updatedAt: 1,
  }
}

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(), dbx.goodsReceipts.clear(), dbx.stockMoves.clear(),
    dbx.suppliers.clear(), dbx.supplierPayments.clear(), dbx.batches.clear(),
    dbx.priceLog.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
  ])
  await initSyncEngine()
  await dbx.meta.put({ key: 'settings', value: DEFAULT_SETTINGS })
})

describe('commitInvoiceImport', () => {
  it('tạo 2 SP mới + 1 phiếu trong một TX', async () => {
    const { gr, productIds } = await commitInvoiceImport({
      supplierName: 'NCC HĐ',
      createSupplier: { name: 'NCC HĐ' },
      date: '2026-08-26',
      expiry: '',
      note: 'test',
      payMethod: 'debt',
      paid: 0,
      newProducts: [
        { name: 'A', cat: '', price: 10000, cost: 7000, stock: 0, unit: 'cái' },
        { name: 'B', cat: '', price: 20000, cost: 12000, stock: 0, unit: 'cái' },
      ],
      rows: [
        { productId: '', name: 'A', unit: 'cái', unitRatio: 1, qty: 2, cost: 7000, expiry: '', newProductIndex: 0 },
        { productId: '', name: 'B', unit: 'cái', unitRatio: 1, qty: 1, cost: 12000, expiry: '', newProductIndex: 1 },
      ],
    })
    expect(productIds).toHaveLength(2)
    expect(await dbx.products.count()).toBe(2)
    expect(await dbx.goodsReceipts.count()).toBe(1)
    expect(gr.rows).toHaveLength(2)
    expect(gr.payMethod).toBe('debt')
  })

  it('throw giữa TX thì rollback 0 SP mới + 0 GR', async () => {
    await expect(commitInvoiceImport({
      supplierName: 'NCC',
      date: '2026-08-26',
      expiry: '',
      note: '',
      payMethod: 'debt',
      paid: 0,
      newProducts: [
        { name: 'A', cat: '', price: 10000, cost: 7000, stock: 0, unit: 'cái' },
      ],
      rows: [
        { productId: '', name: 'A', unit: 'cái', unitRatio: 1, qty: 1, cost: 7000, expiry: '', newProductIndex: 0 },
        { productId: 'p-deleted', name: 'X', unit: 'cái', unitRatio: 1, qty: 1, cost: 1000, expiry: '' },
      ],
    })).rejects.toThrow(/Không tìm thấy hàng|thiếu sản phẩm/)
    expect(await dbx.products.count()).toBe(0)
    expect(await dbx.goodsReceipts.count()).toBe(0)
  })

  it('reject rows thiếu productId', async () => {
    await expect(commitInvoiceImport({
      supplierName: 'NCC',
      date: '2026-08-26',
      expiry: '',
      note: '',
      payMethod: 'debt',
      paid: 0,
      newProducts: [],
      rows: [
        { productId: '', name: 'Lạc', unit: 'cái', unitRatio: 1, qty: 1, cost: 1000, expiry: '' },
      ],
    })).rejects.toThrow(/thiếu sản phẩm/)
    expect(await dbx.goodsReceipts.count()).toBe(0)
  })

  it('GR không HSD: tồn khớp tổng lô', async () => {
    await dbx.products.put(existing())
    await commitInvoiceImport({
      supplierName: 'NCC',
      date: '2026-08-26',
      expiry: '',
      note: '',
      payMethod: 'debt',
      paid: 0,
      newProducts: [],
      rows: [
        { productId: 'p-old', name: 'SP cũ', unit: 'cái', unitRatio: 1, qty: 5, cost: 6000, expiry: '' },
      ],
    })
    const p = await dbx.products.get('p-old')
    const remain = (p?.batches || []).reduce((a, b) => a + b.remain, 0)
    expect(p?.stock).toBe(5)
    expect(remain).toBe(5)
  })
})
