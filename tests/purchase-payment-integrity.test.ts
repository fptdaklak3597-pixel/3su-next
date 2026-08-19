import { beforeEach, describe, expect, it } from 'vitest'
import { dbx } from '@/core/db'
import {
  normalizeReceiptPayment,
  saveGoodsReceipt,
} from '@/core/domain/inventory'
import {
  aggregatePurchases,
  createPurchaseOrder,
  receivePurchaseOrder,
  updatePurchaseOrderStatus,
} from '@/core/domain/purchase'
import {
  createSupplier,
  recordSupplierPayment,
  supplierBalance,
  supplierCredit,
  supplierDebt,
} from '@/core/domain/suppliers'
import { initSyncEngine } from '@/core/sync/engine'
import type { Product } from '@/core/types'

function product(id = 'p1', stock = 0): Product {
  return {
    id,
    name: 'Nước ngọt',
    cat: 'Nước',
    price: 2_000,
    cost: 1_000,
    stock,
    unit: 'chai',
    barcode: '',
    expiry: '',
    units: [{ n: 'lốc', r: 6 }, { n: 'thùng', r: 24 }],
    wholesalePrice: 0,
    batches: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(), dbx.goodsReceipts.clear(), dbx.stockMoves.clear(),
    dbx.suppliers.clear(), dbx.supplierPayments.clear(), dbx.purchaseOrders.clear(),
    dbx.batches.clear(), dbx.priceLog.clear(), dbx.syncQueue.clear(),
    dbx.appliedOps.clear(), dbx.meta.clear(),
  ])
  await initSyncEngine()
})

describe('goods receipt payment invariants', () => {
  it('giữ paid=0 là ghi nợ hết; debt luôn xóa paid stale', () => {
    expect(normalizeReceiptPayment(10_000, 0, 'cash')).toEqual({
      paid: 0, payMethod: 'cash', outstanding: 10_000,
    })
    expect(normalizeReceiptPayment(10_000, 3_000, 'debt')).toEqual({
      paid: 0, payMethod: 'debt', outstanding: 10_000,
    })
    expect(normalizeReceiptPayment(10_000, 10_000, 'transfer')).toEqual({
      paid: 10_000, payMethod: 'transfer', outstanding: 0,
    })
  })

  it('từ chối tiền không hữu hạn, âm hoặc vượt tổng phiếu', () => {
    expect(() => normalizeReceiptPayment(10_000, Number.NaN, 'cash')).toThrow(/không hợp lệ/)
    expect(() => normalizeReceiptPayment(10_000, -1, 'cash')).toThrow(/không hợp lệ/)
    expect(() => normalizeReceiptPayment(10_000, 10_001, 'cash')).toThrow(/vượt/)
  })

  it('từ chối dòng nhập có qty/cost/unitRatio hỏng trước khi ghi DB', async () => {
    await dbx.products.put(product())
    const base = {
      supplier: 'NCC lẻ', date: '2026-08-20', expiry: '', note: '',
      rows: [{ productId: 'p1', name: 'Nước', unit: 'chai', unitRatio: 1, qty: 1, cost: 1_000, expiry: '' }],
    }
    await expect(saveGoodsReceipt({
      ...base,
      rows: [{ ...base.rows[0], qty: Number.NaN }],
    })).rejects.toThrow(/Số lượng/)
    await expect(saveGoodsReceipt({
      ...base,
      rows: [{ ...base.rows[0], cost: Number.POSITIVE_INFINITY }],
    })).rejects.toThrow(/Giá nhập/)
    await expect(saveGoodsReceipt({
      ...base,
      rows: [{ ...base.rows[0], unitRatio: 0 }],
    })).rejects.toThrow(/Quy đổi/)
    expect(await dbx.goodsReceipts.count()).toBe(0)
    expect((await dbx.products.get('p1'))?.stock).toBe(0)
  })
})

describe('purchase order receiving', () => {
  it('nhận một phần đúng unitRatio, ghi PO nguồn và không tính PO thành công nợ', async () => {
    const p = product()
    await dbx.products.put(p)
    const supplier = await createSupplier({ name: 'NCC A' })
    const po = await createPurchaseOrder({
      supplierId: supplier.id,
      supplierName: supplier.name,
      rows: [{
        lineId: 'line-thung', productId: p.id, name: p.name,
        unit: 'thùng', unitRatio: 24, qty: 2, cost: 24_000,
      }],
    })

    await receivePurchaseOrder(po.id, {
      qtys: { 'line-thung': 1 }, payMethod: 'debt', paid: 99_999,
    })

    expect((await dbx.products.get(p.id))?.stock).toBe(24)
    const firstReceipt = (await dbx.goodsReceipts.toArray())[0]!
    expect(firstReceipt.purchaseOrderId).toBe(po.id)
    expect(firstReceipt.rows[0]).toMatchObject({ qty: 1, unitRatio: 24, unit: 'thùng' })
    expect(firstReceipt.total).toBe(24_000)
    expect(firstReceipt.paid).toBe(0)

    const partial = (await dbx.purchaseOrders.get(po.id))!
    expect(partial.status).toBe('ordered')
    expect(partial.rows[0].receivedQty).toBe(1)

    const aggregated = aggregatePurchases([firstReceipt], [partial])
    const poRow = aggregated.find((row) => row.kind === 'po')!
    expect(poRow.total).toBe(24_000)
    expect(poRow.debt).toBe(0)
    expect(supplierDebt(supplier.id, [firstReceipt], [])).toBe(24_000)

    await receivePurchaseOrder(po.id, {
      qtys: { 'line-thung': 1 }, payMethod: 'cash', paid: 24_000,
    })
    expect((await dbx.products.get(p.id))?.stock).toBe(48)
    expect((await dbx.purchaseOrders.get(po.id))?.status).toBe('received')
    const receipts = await dbx.goodsReceipts.toArray()
    expect(receipts).toHaveLength(2)
    expect(supplierDebt(supplier.id, receipts, [])).toBe(24_000)
  })

  it('phân biệt hai dòng cùng product bằng lineId', async () => {
    const p = product()
    await dbx.products.put(p)
    const supplier = await createSupplier({ name: 'NCC A' })
    const po = await createPurchaseOrder({
      supplierId: supplier.id,
      supplierName: supplier.name,
      rows: [
        { lineId: 'chai', productId: p.id, name: p.name, unit: 'chai', unitRatio: 1, qty: 2, cost: 1_000 },
        { lineId: 'loc', productId: p.id, name: p.name, unit: 'lốc', unitRatio: 6, qty: 1, cost: 6_000 },
      ],
    })

    await receivePurchaseOrder(po.id, {
      qtys: { chai: 0, loc: 1 }, payMethod: 'cash', paid: 6_000,
    })

    expect((await dbx.products.get(p.id))?.stock).toBe(6)
    const after = (await dbx.purchaseOrders.get(po.id))!
    expect(after.rows.find((row) => row.lineId === 'chai')?.receivedQty).toBe(0)
    expect(after.rows.find((row) => row.lineId === 'loc')?.receivedQty).toBe(1)
    expect(after.status).toBe('ordered')
  })

  it('hai lần nhận đồng thời chỉ tạo một phiếu và một lần cộng kho', async () => {
    const p = product()
    await dbx.products.put(p)
    const supplier = await createSupplier({ name: 'NCC A' })
    const po = await createPurchaseOrder({
      supplierId: supplier.id,
      supplierName: supplier.name,
      rows: [{ lineId: 'only', productId: p.id, name: p.name, unit: 'chai', unitRatio: 1, qty: 1, cost: 1_000 }],
    })

    const results = await Promise.allSettled([
      receivePurchaseOrder(po.id, { qtys: { only: 1 }, payMethod: 'debt' }),
      receivePurchaseOrder(po.id, { qtys: { only: 1 }, payMethod: 'debt' }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await dbx.goodsReceipts.count()).toBe(1)
    expect((await dbx.products.get(p.id))?.stock).toBe(1)
    expect((await dbx.purchaseOrders.get(po.id))?.status).toBe('received')
  })

  it('không cho set received thủ công và trạng thái terminal không thể nhận hàng', async () => {
    const p = product()
    await dbx.products.put(p)
    const supplier = await createSupplier({ name: 'NCC A' })
    const po = await createPurchaseOrder({
      supplierId: supplier.id,
      supplierName: supplier.name,
      rows: [{ productId: p.id, name: p.name, unit: 'chai', unitRatio: 1, qty: 1, cost: 1_000 }],
    })

    await expect(updatePurchaseOrderStatus(po.id, 'received')).rejects.toThrow(/nhận hàng/)
    await updatePurchaseOrderStatus(po.id, 'cancelled')
    await expect(receivePurchaseOrder(po.id)).rejects.toThrow(/đã hủy/)
  })
})

describe('supplier credit ledger', () => {
  it('giữ phần trả dư dưới dạng credit thay vì làm mất', async () => {
    const p = product()
    await dbx.products.put(p)
    const supplier = await createSupplier({ name: 'NCC A' })
    const receipt = await saveGoodsReceipt({
      supplier: supplier.name,
      supplierId: supplier.id,
      date: '2026-08-20',
      expiry: '',
      note: '',
      rows: [{ productId: p.id, name: p.name, unit: 'chai', unitRatio: 1, qty: 10, cost: 1_000, expiry: '' }],
      paid: 0,
      payMethod: 'debt',
    })
    const payment = await recordSupplierPayment({ supplierId: supplier.id, amount: 15_000 })

    expect(payment.paymentKind).toBe('standalone')
    expect(supplierBalance(supplier.id, [receipt], [payment])).toBe(-5_000)
    expect(supplierDebt(supplier.id, [receipt], [payment])).toBe(0)
    expect(supplierCredit(supplier.id, [receipt], [payment])).toBe(5_000)
  })

  it('từ chối payment NaN/Infinity và không ghi outbox', async () => {
    const supplier = await createSupplier({ name: 'NCC A' })
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()

    await expect(recordSupplierPayment({ supplierId: supplier.id, amount: Number.NaN })).rejects.toThrow(/hợp lệ/)
    await expect(recordSupplierPayment({ supplierId: supplier.id, amount: Number.POSITIVE_INFINITY })).rejects.toThrow(/hợp lệ/)
    expect(await dbx.supplierPayments.count()).toBe(0)
    expect(await dbx.syncQueue.count()).toBe(0)
  })
})
