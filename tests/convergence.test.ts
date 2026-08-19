import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import { applyOps } from '@/core/sync/apply'
import { exportSnapshot, importSnapshot } from '@/core/sync/snapshot'
import { confirmSale } from '@/core/domain/sales'
import { addProduct } from '@/core/domain/inventory'
import { addCustomer, payDebt } from '@/core/domain/customers'
import { makeOp } from '@/core/sync/engine'
import type { SyncOp, StocktakeRecord } from '@/core/types'

/** FakeTransport tối giản: log op dùng chung như DO + D1. */
function makeFakeLog() {
  const log: SyncOp[] = []
  return {
    push(ops: SyncOp[]) {
      for (const op of ops) if (!log.some((o) => o.id === op.id)) log.push(op)
      return log.length
    },
    since(seq: number) { return log.slice(seq) },
  }
}

/** Clear MỌI bảng để mô phỏng máy khác. */
async function wipeAllTables(): Promise<void> {
  await Promise.all(dbx.tables.map((t) => t.clear()))
}

beforeEach(async () => {
  await wipeAllTables()
  await initSyncEngine()
})

describe('convergence — hội tụ 2 máy', () => {
  it('máy A bán + nhập kho, máy B thu nợ — hai chiều hội tụ chính xác', async () => {
    const cloud = makeFakeLog()

    // ── Máy A ──
    const p = await addProduct({ name: 'SP', cat: 'Khác', price: 10000, cost: 6000, stock: 10, unit: 'cái' })
    const c = await addCustomer({ name: 'Khách', phone: '', note: '', wholesale: false })
    await confirmSale({
      items: [{ productId: p.id, qty: 2, unitName: 'cái', unitRatio: 1 }],
      products: [p], discount: 0, payMethod: 'cash', tendered: 5000, customerId: c.id, wholesale: false,
    })
    const seqAtSnap = cloud.push(await dbx.syncQueue.toArray())
    const snapA = (await exportSnapshot()).snapshot
    const expectedStock = (await dbx.products.get(p.id))!.stock // = 8
    const expectedDebt = (await dbx.customers.get(c.id))!.debt // = 15000

    // ── Máy B (join mới, không snapshot: replay toàn bộ log trên DB trống) ──
    await wipeAllTables()
    await initSyncEngine()
    await applyOps(cloud.since(0))
    expect((await dbx.products.get(p.id))!.stock).toBe(expectedStock)
    expect((await dbx.customers.get(c.id))!.debt).toBe(expectedDebt)

    // B thu nợ 10000 → đẩy op lên log
    await payDebt(c.id, 10000)
    cloud.push(await dbx.syncQueue.toArray())

    // ── Máy A quay lại: khôi phục snapshot của MÌNH rồi pull từ upToSeq ──
    await wipeAllTables()
    await initSyncEngine()
    await importSnapshot(snapA)
    await applyOps(cloud.since(seqAtSnap)) // chỉ op của B
    expect((await dbx.customers.get(c.id))!.debt).toBe(expectedDebt - 10000)
    expect((await dbx.products.get(p.id))!.stock).toBe(expectedStock)
  })

  it('kiểm kê ở máy B không nuốt đơn pending của máy A (delta treo)', async () => {
    // Hàng đã có sẵn (không để op init trong outbox — chỉ còn đơn bán chưa đẩy)
    const p = {
      id: 'p_st', name: 'SP', cat: 'Khác', price: 10000, cost: 6000, stock: 10,
      unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0, batches: [],
      createdAt: 1, updatedAt: 1,
    }
    await dbx.products.put(p)
    await confirmSale({
      items: [{ productId: p.id, qty: 2, unitName: 'cái', unitRatio: 1 }],
      products: [p], discount: 0, payMethod: 'cash', tendered: 20000, customerId: null, wholesale: false,
    })
    expect((await dbx.products.get(p.id))!.stock).toBe(8)

    const rec: StocktakeRecord = {
      id: 'st_b', date: '2026-08-14',
      rows: [{ productId: p.id, name: 'SP', system: 10, actual: 100, diff: 90 }],
      note: 'máy B đếm khi chưa thấy đơn A', ts: Date.now(),
    }
    const stOp = makeOp('stocktake.commit', rec)
    await applyOps([{ ...stOp, deviceId: 'dev_b' }])
    expect((await dbx.products.get(p.id))!.stock).toBe(98)
  })
})
