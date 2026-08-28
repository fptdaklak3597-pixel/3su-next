import { beforeEach, describe, expect, it } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import { deleteSupplier, recordSupplierPayment, supplierDebt } from '@/core/domain/suppliers'
import type { GoodsReceipt, Supplier } from '@/core/types'

const supplier: Supplier = {
  id: 'sup-1', name: 'NCC A', phone: '', address: '', note: '', leadDays: 2,
  debt: 0, totalPurchased: 0, orderCount: 0, createdAt: 1, updatedAt: 1,
}

function receipt(total = 10_000, paid = 0): GoodsReceipt {
  return {
    id: 'gr-1', code: 'NK-1', supplier: supplier.name, supplierId: supplier.id,
    date: '2026-08-20', expiry: '', note: '', rows: [], total, paid, ts: 1,
  }
}

beforeEach(async () => {
  await Promise.all([
    dbx.suppliers.clear(), dbx.goodsReceipts.clear(), dbx.supplierPayments.clear(),
    dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
  ])
  await initSyncEngine()
  await dbx.suppliers.put(supplier)
  await dbx.goodsReceipts.put(receipt())
})

describe('supplier payment integrity', () => {
  it('cho trả đúng số dư và ghi op atomic', async () => {
    const payment = await recordSupplierPayment({ supplierId: supplier.id, amount: 10_000 })
    expect(payment.amount).toBe(10_000)
    const payments = await dbx.supplierPayments.toArray()
    expect(supplierDebt(supplier.id, [receipt()], payments)).toBe(0)
    expect((await dbx.syncQueue.toArray()).map((op) => op.type)).toEqual(['supplier.pay'])
  })

  it('từ chối trả vượt công nợ và không ghi dữ liệu', async () => {
    await expect(recordSupplierPayment({
      supplierId: supplier.id,
      amount: 10_001,
    })).rejects.toThrow(/vượt công nợ/)
    expect(await dbx.supplierPayments.count()).toBe(0)
    expect(await dbx.syncQueue.count()).toBe(0)
  })

  it('từ chối NaN, Infinity và ngày sai định dạng', async () => {
    await expect(recordSupplierPayment({ supplierId: supplier.id, amount: Number.NaN })).rejects.toThrow(/hợp lệ/)
    await expect(recordSupplierPayment({ supplierId: supplier.id, amount: Number.POSITIVE_INFINITY })).rejects.toThrow(/hợp lệ/)
    await expect(recordSupplierPayment({ supplierId: supplier.id, amount: 1_000, date: '20/08/2026' })).rejects.toThrow(/Ngày/)
  })

  it('hai lần trả đồng thời không thể vượt tổng công nợ', async () => {
    const results = await Promise.allSettled([
      recordSupplierPayment({ supplierId: supplier.id, amount: 7_000, note: 'lần 1' }),
      recordSupplierPayment({ supplierId: supplier.id, amount: 7_000, note: 'lần 2' }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await dbx.supplierPayments.toArray()).reduce((sum, payment) => sum + payment.amount, 0)).toBe(7_000)
  })

  it('không cho ghi chú bị hiểu nhầm là payment legacy theo phiếu', async () => {
    await expect(recordSupplierPayment({
      supplierId: supplier.id,
      amount: 1_000,
      note: 'Thanh toán phiếu nhập NK-1',
    })).rejects.toThrow(/định dạng/)
  })

  it('không xóa NCC còn nợ', async () => {
    await expect(deleteSupplier(supplier.id)).rejects.toThrow(/còn nợ/)
    const row = await dbx.suppliers.get(supplier.id)
    expect(row?.deleted).not.toBe(true)
  })
})
