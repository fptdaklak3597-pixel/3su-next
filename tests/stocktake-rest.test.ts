import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine, makeOp } from '@/core/sync/engine'
import { applyOps } from '@/core/sync/apply'
import { saveStocktake } from '@/core/domain/inventory'
import type { Product, ProductBatch, SyncOp } from '@/core/types'

function mkProduct(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', name: 'Mì', cat: 'Khô', price: 100, cost: 60, stock: 10,
    unit: 'gói', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: 1, updatedAt: 1, ...over,
  }
}

function remoteOp(type: SyncOp['type'], payload: unknown): SyncOp {
  return { ...makeOp(type, payload), deviceId: 'dev_remote' }
}

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(), dbx.stockMoves.clear(), dbx.stocktakes.clear(),
    dbx.batches.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
  ])
  await initSyncEngine()
})

describe('M11 — stocktake remote ghi move', () => {
  it('diff +3 → stock 13 + 1 move id ổn định; apply lần 2 (xóa appliedOps) không cộng đôi', async () => {
    await dbx.products.add(mkProduct({ stock: 10 }))
    const op = remoteOp('stocktake.commit', {
      id: 'st1', date: '2026-08-18',
      rows: [{ productId: 'p1', name: 'Mì', system: 10, actual: 13, diff: 3 }],
      note: '', ts: 1,
    })
    await applyOps([op])
    expect((await dbx.products.get('p1'))!.stock).toBe(13)
    const mvId = `mv_${op.id}_p1`
    expect((await dbx.stockMoves.get(mvId))!.qty).toBe(3)
    await dbx.appliedOps.clear()
    await applyOps([op])
    expect((await dbx.products.get('p1'))!.stock).toBe(13)
    expect(await dbx.stockMoves.count()).toBe(1)
  })
})

describe('M1 — kiểm kê khớp lô', () => {
  it('local thiếu 4 → trừ FEFO; thừa 2 → thêm lô kiểm kê', async () => {
    const b1: ProductBatch = { id: 'b1', qty: 6, remain: 6, cost: 60, expiry: '2026-09-01', date: '2026-08-01' }
    const b2: ProductBatch = { id: 'b2', qty: 4, remain: 4, cost: 60, expiry: '2026-12-01', date: '2026-08-10' }
    await dbx.products.add(mkProduct({ stock: 10, batches: [b1, b2] }))
    await dbx.batches.bulkAdd([b1, b2])
    await saveStocktake([{ productId: 'p1', name: 'Mì', system: 10, actual: 6 }], 'thiếu')
    const after = (await dbx.products.get('p1'))!
    expect(after.stock).toBe(6)
    expect(after.batches.find((b) => b.id === 'b1')!.remain).toBe(2)
    expect(after.batches.find((b) => b.id === 'b2')!.remain).toBe(4)

    await saveStocktake([{ productId: 'p1', name: 'Mì', system: 6, actual: 8 }], 'thừa')
    const plus = (await dbx.products.get('p1'))!
    expect(plus.stock).toBe(8)
    expect(plus.batches.reduce((s, b) => s + b.remain, 0)).toBe(8)
  })
})

describe('N2 — saveStocktake bỏ qua system UI cũ', () => {
  it('tồn live 8, UI gửi system 10 / actual 12 → stock 12, move +4, outbox system 8 / diff 4', async () => {
    await dbx.products.add(mkProduct({ stock: 8 }))
    const record = await saveStocktake(
      [{ productId: 'p1', name: 'Mì', system: 10, actual: 12 }],
      'UI đóng băng',
    )
    expect((await dbx.products.get('p1'))!.stock).toBe(12)
    expect(record.rows[0]).toMatchObject({ system: 8, actual: 12, diff: 4 })
    const moves = await dbx.stockMoves.toArray()
    expect(moves).toHaveLength(1)
    expect(moves[0].qty).toBe(4)
    const op = (await dbx.syncQueue.toArray()).find((o) => o.type === 'stocktake.commit')!
    const payload = op.payload as typeof record
    expect(payload.rows[0]).toMatchObject({ system: 8, diff: 4, actual: 12 })
  })
})
