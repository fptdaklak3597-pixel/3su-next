/**
 * Đợt 2 — sync errors / M12 seed / M8+L8 restore file.
 * Chạy: npx vitest run tests/sync-rest.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx, restoreBackup, restoreLocalBackup, type BackupData } from '@/core/db'
import { parseRestoreFile } from '@/core/domain/trial'
import { seedCatalog } from '@/core/domain/seed'
import { initSyncEngine, makeOp } from '@/core/sync/engine'
import {
  applyOps,
  getBlockedOps,
  getPoisonedOps,
  SyncDependencyError,
} from '@/core/sync/apply'
import type { Product, Sale, SyncOp } from '@/core/types'

function mkProduct(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', name: 'Mì', cat: 'Khô', price: 100, cost: 60, stock: 10,
    unit: 'gói', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: 1, updatedAt: 1, ...over,
  }
}

function remoteOp(type: SyncOp['type'], payload: unknown): SyncOp {
  const op = makeOp(type, payload)
  return { ...op, deviceId: 'dev_remote' }
}

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
    dbx.stockMoves.clear(), dbx.goodsReceipts.clear(), dbx.syncQueue.clear(),
    dbx.appliedOps.clear(), dbx.meta.clear(),
  ])
  await initSyncEngine()
})

describe('S3 — dependency lỗi không chặn op tốt phía sau', () => {
  it('sale.commit thiếu SP rồi stock.adjust → adjust vẫn áp, sale bị blocked để retry', async () => {
    await dbx.products.add(mkProduct({ id: 'p1', stock: 10 }))
    const badSale: Sale = {
      id: 's_bad',
      items: [{ productId: 'p-missing', name: 'x', qty: 1, price: 100, cost: 60, unit: 'gói', unitRatio: 1 }],
      total: 100, profit: 40, discount: 0, payMethod: 'cash',
      tendered: 100, change: 0, debtAmount: 0, customerId: null,
      date: '2026-08-18',
    }
    const bad = remoteOp('sale.commit', badSale)
    const good = remoteOp('stock.adjust', { productId: 'p1', delta: -3, reason: 'sau dependency' })

    expect(await applyOps([bad, good])).toBe(1)
    expect(await dbx.sales.count()).toBe(0)
    expect((await dbx.products.get('p1'))!.stock).toBe(7)
    expect(await dbx.appliedOps.get(bad.id)).toBeUndefined()
    expect(await dbx.appliedOps.get(good.id)).toBeTruthy()
    expect((await getPoisonedOps()).find((op) => op.id === bad.id)).toBeUndefined()
    const blocked = await getBlockedOps()
    expect(blocked).toHaveLength(1)
    expect(blocked[0]!.id).toBe(bad.id)
    expect(blocked[0]!.type).toBe('sale.commit')
    expect(blocked[0]!.message).toMatch(/thiếu SP/)
  })
})

describe('M12 — seed phát op', () => {
  it('2 mặt hàng mới stock 4 → 2 upsert + 2 adjust; tên trùng bỏ qua', async () => {
    await dbx.products.add(mkProduct({ id: 'old', name: 'Mì sẵn' }))
    const res = await seedCatalog([
      { name: 'Mì sẵn', price: 1, cost: 1, unit: 'gói', cat: 'Khô', emoji: '🍜' },
      { name: 'Sting', price: 10, cost: 7, unit: 'lon', cat: 'Nước', emoji: '🥤' },
      { name: 'Lavie', price: 5, cost: 3, unit: 'chai', cat: 'Nước', emoji: '💧' },
    ], 4)
    expect(res).toEqual({ added: 2, skipped: 1 })
    const ops = await dbx.syncQueue.toArray()
    expect(ops.filter((o) => o.type === 'product.upsert')).toHaveLength(2)
    expect(ops.filter((o) => o.type === 'stock.adjust')).toHaveLength(2)
    const sting = (await dbx.products.toArray()).find((p) => p.name === 'Sting')!
    expect(sting.stock).toBe(4)
    const upsert = ops.find((o) => o.type === 'product.upsert' && (o.payload as { product: { id: string } }).product.id === sting.id)!
    expect((upsert.payload as { product: { stock?: number } }).product.stock).toBeUndefined()
  })
})

function emptyBackup(over: Partial<BackupData> = {}): BackupData {
  return {
    version: 5,
    exportedAt: '2026-08-18T00:00:00.000Z',
    shop: { name: 'Cửa hàng', phone: '', address: '' },
    settings: {
      lowStock: 5, hsdWarnDays: 14, showCostInCart: false, compactRows: false,
      soundOn: true, celebrateOnSale: true, allowNegativeStock: true, theme: 'light',
      largeText: false, transferQr: '', transferQrNote: '', bankBin: '', bankAccount: '',
      bankAccountName: '',
      printer: {
        width: 58, fontSize: 12, autoPrintAfterSale: false, cloudRelay: false,
        lanAgentUrl: '', templateHeader: '', templateFooter: '', showLogo: false,
      },
    },
    products: [], sales: [], customers: [],
    debtPayments: [], goodsReceipts: [], stockMoves: [], stocktakes: [],
    ...over,
  }
}

describe('L8 — parseRestoreFile', () => {
  it('thiếu products → throw', () => {
    expect(() => parseRestoreFile('{"sales":[],"customers":[]}')).toThrow(/products/)
  })
  it('JSON đủ mảng bắt buộc → trả BackupData', () => {
    const d = parseRestoreFile('{"products":[],"sales":[],"customers":[],"sourceShopId":"shop-a"}')
    expect(d.products).toEqual([])
    expect(d.sourceShopId).toBe('shop-a')
  })
})

describe('M8 — restore safety', () => {
  it('file local restore tách khỏi cloud và xóa toàn bộ sync state cũ', async () => {
    const deviceId = (await dbx.meta.get('deviceId'))!.value
    const pending = remoteOp('stock.adjust', { productId: 'p1', delta: 1, reason: 'cũ' })
    await dbx.products.add(mkProduct())
    await dbx.syncQueue.add(pending)
    await dbx.appliedOps.add({ id: pending.id })
    await dbx.meta.bulkPut([
      { key: 'currentUser', value: { id: 'u-old' } },
      { key: 'cloud:shopId', value: 'shop-old' },
      { key: 'cloud:role', value: 'owner' },
      { key: 'cloud:license', value: { status: 'active' } },
      { key: 'sync:lastSeq', value: 40 },
      { key: 'sync:lastSnapshotAt', value: 123 },
      { key: 'sync:lastSnapshotSeq', value: 30 },
      { key: 'sync:poisoned', value: [{ id: 'bad' }] },
      { key: 'sync:blocked', value: [{ id: 'wait' }] },
    ])

    await restoreLocalBackup(emptyBackup({
      sourceShopId: 'shop-backup',
      products: [mkProduct({ id: 'p9', name: 'Từ file', stock: 1 })],
    }))

    expect(await dbx.syncQueue.count()).toBe(0)
    expect(await dbx.appliedOps.count()).toBe(0)
    expect(await dbx.meta.get('sync:lastSeq')).toBeUndefined()
    expect(await dbx.meta.get('sync:lastSnapshotAt')).toBeUndefined()
    expect(await dbx.meta.get('sync:lastSnapshotSeq')).toBeUndefined()
    expect(await dbx.meta.get('sync:poisoned')).toBeUndefined()
    expect(await dbx.meta.get('sync:blocked')).toBeUndefined()
    expect(await dbx.meta.get('currentUser')).toBeUndefined()
    expect(await dbx.meta.get('cloud:shopId')).toBeUndefined()
    expect(await dbx.meta.get('cloud:role')).toBeUndefined()
    expect(await dbx.meta.get('cloud:license')).toBeUndefined()
    expect((await dbx.meta.get('cloud:paused'))?.value).toBe(true)
    expect((await dbx.meta.get('deviceId'))?.value).toBe(deviceId)
    expect((await dbx.meta.get('restore:last'))?.value).toMatchObject({
      sourceShopId: 'shop-backup',
      detachedFromShopId: 'shop-old',
    })
    expect(await dbx.products.get('p9')).toBeTruthy()
    expect(await dbx.products.get('p1')).toBeUndefined()
  })

  it('restoreBackup dùng cho snapshot cloud không xóa outbox/cursor/appliedOps', async () => {
    const pending = remoteOp('stock.adjust', { productId: 'p1', delta: 1, reason: 'pending' })
    await dbx.syncQueue.add(pending)
    await dbx.appliedOps.add({ id: pending.id })
    await dbx.meta.put({ key: 'sync:lastSeq', value: 40 })

    await restoreBackup(emptyBackup())

    expect(await dbx.syncQueue.count()).toBe(1)
    expect(await dbx.appliedOps.count()).toBe(1)
    expect((await dbx.meta.get('sync:lastSeq'))?.value).toBe(40)
  })
})
