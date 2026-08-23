import { beforeEach, describe, expect, it } from 'vitest'
import { dbx } from '@/core/db'
import { estimateLocalDataSize } from '@/core/domain/readiness'
import { initSyncEngine } from '@/core/sync/engine'

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
    dbx.invoices.clear(), dbx.notes.clear(), dbx.purchaseOrders.clear(),
  ])
  await initSyncEngine()
})

describe('L7 — estimateLocalDataSize', () => {
  it('đếm cả invoices / notes chứ không chỉ 6 bảng lõi', async () => {
    const empty = await estimateLocalDataSize()
    await dbx.invoices.add({
      id: 'inv1', code: 'HD-1', type: 'gdt', date: '2026-08-01',
      amount: 1, tax: 0, status: 'issued',
      data: { note: 'x'.repeat(400) }, ts: 1,
    })
    await dbx.notes.add({
      id: 'n1', text: 'ghi chú '.repeat(80), date: '2026-08-01T00:00:00.000Z',
      type: 'note', done: false, pinned: false,
    })
    const after = await estimateLocalDataSize()
    expect(after).toBeGreaterThan(empty)
  })
})
