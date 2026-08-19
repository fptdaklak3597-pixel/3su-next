import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine, lastSeqAfterSnapshot, makeOp } from '@/core/sync/engine'
import { applyOps, getPoisonedOps } from '@/core/sync/apply'
import { addProduct } from '@/core/domain/inventory'
import type { Product, SyncOp } from '@/core/types'

function mkProduct(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', name: 'Mì', cat: 'Khô', price: 100, cost: 60, stock: 10,
    unit: 'gói', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: 1, updatedAt: 1, ...over,
  }
}

beforeEach(async () => {
  await Promise.all([dbx.products.clear(), dbx.stockMoves.clear(), dbx.appliedOps.clear(), dbx.meta.clear(), dbx.syncQueue.clear()])
  await initSyncEngine()
})

describe('M2 — stock.adjust replay', () => {
  it('xóa appliedOps rồi apply lại cùng op → stock không đổi lần 2', async () => {
    await dbx.products.add(mkProduct({ stock: 10 }))
    const op: SyncOp = { ...makeOp('stock.adjust', { productId: 'p1', delta: 5, reason: 'x' }), deviceId: 'dev_remote' }
    await applyOps([op])
    expect((await dbx.products.get('p1'))!.stock).toBe(15)
    await dbx.appliedOps.clear()
    expect(await applyOps([op])).toBe(1)
    expect((await dbx.products.get('p1'))!.stock).toBe(15)
    expect(await dbx.stockMoves.count()).toBe(1)
    expect(await getPoisonedOps()).toEqual([])
  })

  it('originator addProduct: clear appliedOps rồi applyOps adjust → stock không nhân đôi', async () => {
    const p = await addProduct({
      name: 'SP originator', cat: 'Khác', price: 5000, cost: 3000, stock: 20, unit: 'cái',
    })
    const adjustOp = (await dbx.syncQueue.toArray()).find((o) => o.type === 'stock.adjust')!
    expect(adjustOp).toBeTruthy()
    const moves = await dbx.stockMoves.toArray()
    expect(moves).toHaveLength(1)
    expect(moves[0].id).toBe('mv_' + adjustOp.id)

    await dbx.appliedOps.clear()
    expect(await applyOps([adjustOp])).toBe(1)
    expect((await dbx.products.get(p.id))!.stock).toBe(20)
    expect(await dbx.stockMoves.count()).toBe(1)
    expect(await getPoisonedOps()).toEqual([])
  })
})

describe('S5 — lastSeq sau snapshot', () => {
  it('máy đã sync không nhảy lên upToSeq của snapshot người khác', () => {
    expect(lastSeqAfterSnapshot(40, 200)).toBe(40)
  })
  it('máy mới lastSeq 0 nhận mốc snapshot', () => {
    expect(lastSeqAfterSnapshot(0, 200)).toBe(200)
  })
})
