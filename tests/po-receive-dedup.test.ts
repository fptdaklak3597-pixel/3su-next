import { beforeEach, describe, expect, it } from 'vitest'
import { dbx } from '@/core/db'
import { createPurchaseOrder, receivePurchaseOrder } from '@/core/domain/purchase'
import {
  applyReceiptsToPoRows,
  goodsReceiptIdForPurchaseOrder,
  poReceiveWouldOverflow,
} from '@/core/domain/po-receive'
import { createSupplier } from '@/core/domain/suppliers'
import { applyOps } from '@/core/sync/apply'
import { initSyncEngine } from '@/core/sync/engine'
import { exportSnapshot, importSnapshot } from '@/core/sync/snapshot'
import type { GoodsReceipt, Product, PurchaseOrder, SyncOp } from '@/core/types'

function product(id = 'p1', stock = 0): Product {
  return {
    id,
    name: 'Mì',
    cat: 'Khô',
    price: 100,
    cost: 40,
    stock,
    unit: 'gói',
    barcode: '',
    expiry: '',
    units: [],
    wholesalePrice: 0,
    batches: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

async function wipeAllTables(): Promise<void> {
  await Promise.all(dbx.tables.map((t) => t.clear()))
}

beforeEach(async () => {
  await wipeAllTables()
  await initSyncEngine()
})

describe('po-receive helpers', () => {
  it('cùng lần nhận (prior + qty) → cùng id; lần nhận tiếp theo khác id', () => {
    const a = goodsReceiptIdForPurchaseOrder('po1', [
      { lineKey: 'line-a', priorReceived: 0, qty: 5 },
    ])
    const b = goodsReceiptIdForPurchaseOrder('po1', [
      { lineKey: 'line-a', priorReceived: 0, qty: 5 },
    ])
    const next = goodsReceiptIdForPurchaseOrder('po1', [
      { lineKey: 'line-a', priorReceived: 5, qty: 5 },
    ])
    expect(a).toBe(b)
    expect(a).toMatch(/^gr_po_po1_[0-9a-f]{8}$/)
    expect(next).not.toBe(a)
  })

  it('overflow khi phiếu mới vượt SL đặt; 3+7 cùng 10 thì không', () => {
    const po: PurchaseOrder = {
      id: 'po1', code: 'PO-1', supplierId: 's1', supplierName: 'NCC',
      rows: [{ lineId: 'l1', productId: 'p1', name: 'Mì', unit: 'gói', qty: 10, cost: 40, receivedQty: 0 }],
      total: 400, status: 'ordered', note: '', date: '2026-08-30', ts: 1,
    }
    const first: GoodsReceipt = {
      id: 'gr_a', code: 'NK-A', supplier: 'NCC', supplierId: 's1', purchaseOrderId: 'po1',
      date: '2026-08-30', expiry: '', note: '',
      rows: [{ productId: 'p1', name: 'Mì', unit: 'gói', unitRatio: 1, qty: 10, cost: 40, expiry: '', lineId: 'l1' }],
      total: 400, ts: 1,
    }
    const dup: GoodsReceipt = { ...first, id: 'gr_b', code: 'NK-B' }
    expect(poReceiveWouldOverflow(po, [first], dup)).toBe(true)
    expect(poReceiveWouldOverflow(po, [], first)).toBe(false)

    const partA = { ...first, id: 'gr_3', rows: [{ ...first.rows[0]!, qty: 3 }] }
    const partB = { ...first, id: 'gr_7', rows: [{ ...first.rows[0]!, qty: 7 }] }
    expect(poReceiveWouldOverflow(po, [partA], partB)).toBe(false)
  })

  it('applyReceiptsToPoRows cộng theo lineId', () => {
    const rows = [
      { lineId: 'a', productId: 'p1', name: 'Mì', unit: 'gói', qty: 10, cost: 40, receivedQty: 0 },
    ]
    const receipts: GoodsReceipt[] = [{
      id: 'gr1', code: 'NK', supplier: 'NCC', purchaseOrderId: 'po1',
      date: '2026-08-30', expiry: '', note: '',
      rows: [{ productId: 'p1', name: 'Mì', unit: 'gói', unitRatio: 1, qty: 4, cost: 40, expiry: '', lineId: 'a' }],
      total: 160, ts: 1,
    }]
    expect(applyReceiptsToPoRows(rows, receipts)[0]!.receivedQty).toBe(4)
  })
})

describe('M3 — hai máy offline cùng nhận một PO', () => {
  it('cùng nhận đủ SL → cùng gr.id; apply chéo không nhân đôi tồn / mua NCC', async () => {
    await dbx.products.put(product())
    const supplier = await createSupplier({ name: 'NCC A' })
    const po = await createPurchaseOrder({
      supplierId: supplier.id,
      supplierName: supplier.name,
      rows: [{ lineId: 'only', productId: 'p1', name: 'Mì', unit: 'gói', qty: 10, cost: 40 }],
    })
    const { snapshot } = await exportSnapshot()

    await receivePurchaseOrder(po.id, { payMethod: 'debt' })
    const opsA = (await dbx.syncQueue.toArray()) as SyncOp[]
    const grA = (await dbx.goodsReceipts.toArray())[0]!
    expect(grA.id.startsWith('gr_po_')).toBe(true)
    expect((await dbx.products.get('p1'))!.stock).toBe(10)
    const purchasedA = (await dbx.suppliers.get(supplier.id))!.totalPurchased

    await wipeAllTables()
    await initSyncEngine()
    await importSnapshot(snapshot)
    await receivePurchaseOrder(po.id, { payMethod: 'debt' })
    const grB = (await dbx.goodsReceipts.toArray())[0]!
    expect(grB.id).toBe(grA.id)

    await applyOps(opsA)
    expect(await dbx.goodsReceipts.count()).toBe(1)
    expect((await dbx.products.get('p1'))!.stock).toBe(10)
    expect((await dbx.suppliers.get(supplier.id))!.totalPurchased).toBe(purchasedA)
    expect((await dbx.purchaseOrders.get(po.id))!.status).toBe('received')
  })

  it('gr.commit id khác nhưng PO đã đủ SL → skip, không cộng kho', async () => {
    await dbx.products.put(product('p1', 10))
    const supplier = await createSupplier({ name: 'NCC A' })
    await dbx.purchaseOrders.put({
      id: 'po_full', code: 'PO-F', supplierId: supplier.id, supplierName: supplier.name,
      rows: [{ lineId: 'only', productId: 'p1', name: 'Mì', unit: 'gói', qty: 10, cost: 40, receivedQty: 10 }],
      total: 400, status: 'received', note: '', date: '2026-08-30', ts: 1,
    })
    await dbx.goodsReceipts.add({
      id: 'gr_first', code: 'NK-1', supplier: supplier.name, supplierId: supplier.id,
      purchaseOrderId: 'po_full', date: '2026-08-30', expiry: '', note: '',
      rows: [{ productId: 'p1', name: 'Mì', unit: 'gói', unitRatio: 1, qty: 10, cost: 40, expiry: '', lineId: 'only' }],
      total: 400, ts: 1,
    })
    await dbx.suppliers.update(supplier.id, { totalPurchased: 400, orderCount: 1 })

    const { makeOp } = await import('@/core/sync/engine')
    const dup: GoodsReceipt = {
      id: 'gr_other', code: 'NK-2', supplier: supplier.name, supplierId: supplier.id,
      purchaseOrderId: 'po_full', date: '2026-08-30', expiry: '', note: '',
      rows: [{ productId: 'p1', name: 'Mì', unit: 'gói', unitRatio: 1, qty: 10, cost: 40, expiry: '', lineId: 'only' }],
      total: 400, ts: 2,
    }
    const op = makeOp('gr.commit', { gr: dup, patches: [] })
    const applied = await applyOps([{ ...op, deviceId: 'dev_remote' }])
    expect(applied).toBe(1)
    expect(await dbx.goodsReceipts.count()).toBe(1)
    expect(await dbx.goodsReceipts.get('gr_other')).toBeUndefined()
    expect((await dbx.products.get('p1'))!.stock).toBe(10)
    expect((await dbx.suppliers.get(supplier.id))!.totalPurchased).toBe(400)
  })
})
