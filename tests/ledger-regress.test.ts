/**
 * Hồi quy sổ tiền đợt 1 — S1 / S2 / M10 / M3 / M4 + nợ âm cũ.
 * Chạy: npx vitest run tests/ledger-regress.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import { saveGoodsReceipt } from '@/core/domain/inventory'
import { supplierDebt, recordSupplierPayment } from '@/core/domain/suppliers'
import { addCustomer, payDebt, clampNegativeCustomerDebts } from '@/core/domain/customers'
import { confirmSale, voidSale } from '@/core/domain/sales'
import { createPurchaseOrder, receivePurchaseOrder } from '@/core/domain/purchase'
import type { Product } from '@/core/types'

function mkProduct(over: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Mì',
    cat: 'Khô',
    price: 100,
    cost: 100,
    stock: 50,
    unit: 'gói',
    barcode: '',
    expiry: '',
    units: [],
    wholesalePrice: 0,
    batches: [],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

beforeEach(async () => {
  await dbx.transaction(
    'rw',
    [
      dbx.products, dbx.sales, dbx.customers, dbx.stockMoves, dbx.goodsReceipts,
      dbx.debtPayments, dbx.suppliers, dbx.supplierPayments, dbx.purchaseOrders,
      dbx.batches, dbx.priceLog, dbx.syncQueue, dbx.appliedOps, dbx.meta,
    ],
    async () => {
      await Promise.all([
        dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
        dbx.stockMoves.clear(), dbx.goodsReceipts.clear(), dbx.debtPayments.clear(),
        dbx.suppliers.clear(), dbx.supplierPayments.clear(), dbx.purchaseOrders.clear(),
        dbx.batches.clear(), dbx.priceLog.clear(), dbx.syncQueue.clear(),
        dbx.appliedOps.clear(), dbx.meta.clear(),
      ])
    },
  )
  await initSyncEngine()
})

describe('S1 — nợ NCC không trừ trùng', () => {
  it('nhập 100 trả 70 → debt 30, không tạo SupplierPayment', async () => {
    await dbx.products.add(mkProduct())
    await saveGoodsReceipt({
      supplier: 'NCC A',
      supplierId: 'sup1',
      date: '2026-08-18',
      expiry: '',
      note: '',
      rows: [{ productId: 'p1', name: 'Mì', unit: 'gói', unitRatio: 1, qty: 1, cost: 100, expiry: '' }],
      paid: 70,
      payMethod: 'cash',
    })
    const receipts = await dbx.goodsReceipts.toArray()
    const payments = await dbx.supplierPayments.toArray()
    expect(receipts[0]?.paid).toBe(70)
    expect(payments).toHaveLength(0)
    expect(supplierDebt('sup1', receipts, payments)).toBe(30)
  })

  it('trả sau 30 → debt 0, một phiếu chi', async () => {
    await dbx.products.add(mkProduct())
    await saveGoodsReceipt({
      supplier: 'NCC A',
      supplierId: 'sup1',
      date: '2026-08-18',
      expiry: '',
      note: '',
      rows: [{ productId: 'p1', name: 'Mì', unit: 'gói', unitRatio: 1, qty: 1, cost: 100, expiry: '' }],
      paid: 70,
      payMethod: 'cash',
    })
    await dbx.suppliers.put({
      id: 'sup1', name: 'NCC A', phone: '', address: '', note: '', leadDays: 2,
      debt: 0, totalPurchased: 0, orderCount: 0, createdAt: 1, updatedAt: 1,
    })
    await recordSupplierPayment({ supplierId: 'sup1', amount: 30, note: 'Trả nốt' })
    const receipts = await dbx.goodsReceipts.toArray()
    const payments = await dbx.supplierPayments.toArray()
    expect(payments).toHaveLength(1)
    expect(supplierDebt('sup1', receipts, payments)).toBe(0)
  })

  it('dữ liệu cũ: payment note Thanh toán phiếu nhập không trừ lần nữa', async () => {
    await dbx.goodsReceipts.add({
      id: 'gr1', code: 'NK-20260818-100', supplier: 'A', supplierId: 'sup1',
      date: '2026-08-18', expiry: '', note: '', rows: [], total: 100, paid: 70, ts: 1,
    })
    await dbx.supplierPayments.add({
      id: 'sp1', supplierId: 'sup1', amount: 70, date: '2026-08-18',
      note: 'Thanh toán phiếu nhập NK-20260818-100',
    })
    const receipts = await dbx.goodsReceipts.toArray()
    const payments = await dbx.supplierPayments.toArray()
    expect(supplierDebt('sup1', receipts, payments)).toBe(30)
  })
})

describe('S2 / M10 — nợ khách sàn 0', () => {
  it('bán nợ 100 → thu 100 → hủy → debt 0', async () => {
    await dbx.products.add(mkProduct({ price: 100, cost: 60, stock: 10 }))
    const c = await addCustomer({ name: 'An', phone: '', note: '', wholesale: false })
    const { sale } = await confirmSale({
      items: [{ productId: 'p1', qty: 1, unitName: 'gói', unitRatio: 1 }],
      products: [],
      discount: 0,
      payMethod: 'debt',
      tendered: 0,
      customerId: c.id,
      wholesale: false,
    })
    expect((await dbx.customers.get(c.id))!.debt).toBe(100)
    await payDebt(c.id, 100)
    expect((await dbx.customers.get(c.id))!.debt).toBe(0)
    await voidSale(sale.id, 'khách đổi ý')
    expect((await dbx.customers.get(c.id))!.debt).toBe(0)
  })

  it('thu vượt nợ → từ chối; thu đúng → debt 0', async () => {
    const c = await addCustomer({ name: 'An', phone: '', note: '', wholesale: false })
    await dbx.customers.update(c.id, { debt: 100 })
    await expect(payDebt(c.id, 500)).rejects.toThrow(/vượt công nợ/)
    expect(await payDebt(c.id, 100)).toBe(100)
    expect((await dbx.customers.get(c.id))!.debt).toBe(0)
    const pays = await dbx.debtPayments.toArray()
    expect(pays).toHaveLength(1)
    expect(pays[0]!.amount).toBe(100)
  })

  it('clampNegativeCustomerDebts đưa −100 về 0', async () => {
    await dbx.customers.add({
      id: 'c-neg', name: 'Cũ', phone: '', note: '', debt: -100,
      totalSpent: 0, orderCount: 0, createdAt: 1, updatedAt: 1,
    })
    const n = await clampNegativeCustomerDebts()
    expect(n).toBe(1)
    expect((await dbx.customers.get('c-neg'))!.debt).toBe(0)
  })
})

describe('M3 / M4 — nhập kho', () => {
  it('GR thiếu SP → throw, không lưu phiếu', async () => {
    await expect(saveGoodsReceipt({
      supplier: 'A',
      date: '2026-08-18',
      expiry: '',
      note: '',
      rows: [{ productId: 'ghost', name: 'Ma', unit: 'gói', unitRatio: 1, qty: 1, cost: 50, expiry: '' }],
    })).rejects.toThrow(/Không tìm thấy hàng/)
    expect(await dbx.goodsReceipts.count()).toBe(0)
  })

  it('receivePurchaseOrder lần 2 → throw đã nhập kho', async () => {
    await dbx.products.add(mkProduct({ stock: 0 }))
    const po = await createPurchaseOrder({
      supplierId: 's1',
      supplierName: 'NCC',
      rows: [{ productId: 'p1', name: 'Mì', unit: 'gói', qty: 2, cost: 40 }],
    })
    await receivePurchaseOrder(po.id, { payMethod: 'debt' })
    await expect(receivePurchaseOrder(po.id, { payMethod: 'debt' })).rejects.toThrow(/đã nhập kho/)
    expect(await dbx.goodsReceipts.count()).toBe(1)
    expect((await dbx.products.get('p1'))!.stock).toBe(2)
  })
})
