/**
 * Đợt 2 — S3 poison / M12 seed / M8+L8 restore file.
 * Chạy: npx vitest run tests/sync-rest.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx, restoreBackup, restoreLocalBackup, type BackupData } from '@/core/db'
import { parseRestoreFile } from '@/core/domain/trial'
import { seedCatalog } from '@/core/domain/seed'
import { initSyncEngine, makeOp } from '@/core/sync/engine'
import { applyOps, getPoisonedOps } from '@/core/sync/apply'
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

describe('S3 — op độc không chặn op sau', () => {
  it('sale.commit thiếu SP rồi stock.adjust → adjust vẫn áp, poisoned ghi meta', async () => {
    await dbx.products.add(mkProduct({ id: 'p1', stock: 10 }))
    const badSale: Sale = {
      id: 's_bad',
      items: [{ productId: 'p-missing', name: 'x', qty: 1, price: 100, cost: 60, unit: 'gói', unitRatio: 1 }],
      total: 100, profit: 40, discount: 0, payMethod: 'cash',
      tendered: 100, change: 0, debtAmount: 0, customerId: null,
      date: '2026-08-18',
    }
    const bad = remoteOp('sale.commit', badSale)
    const good = remoteOp('stock.adjust', { productId: 'p1', delta: -3, reason: 'sau độc' })
    await expect(applyOps([bad, good])).resolves.toBe(1)
    expect(await dbx.sales.count()).toBe(0)
    expect((await dbx.products.get('p1'))!.stock).toBe(7)
    expect(await dbx.appliedOps.get(bad.id)).toBeTruthy()
    expect(await dbx.appliedOps.get(good.id)).toBeTruthy()
    const poisoned = await getPoisonedOps()
    expect(poisoned).toHaveLength(1)
    expect(poisoned[0]!.id).toBe(bad.id)
    expect(poisoned[0]!.type).toBe('sale.commit')
    expect(poisoned[0]!.message).toMatch(/thiếu SP/)
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
    const d = parseRestoreFile('{"products":[],"sales":[],"customers":[]}')
    expect(d.products).toEqual([])
  })
})

describe('M8 — restoreLocalBackup xóa outbox, restoreBackup thì không', () => {
  it('file restore xóa syncQueue, giữ lastSeq', async () => {
    await dbx.products.add(mkProduct())
    await dbx.syncQueue.add(remoteOp('stock.adjust', { productId: 'p1', delta: 1, reason: 'cũ' }))
    await dbx.meta.put({ key: 'sync:lastSeq', value: 40 })
    await restoreLocalBackup(emptyBackup({
      products: [mkProduct({ id: 'p9', name: 'Từ file', stock: 1 })],
    }))
    expect(await dbx.syncQueue.count()).toBe(0)
    expect((await dbx.meta.get('sync:lastSeq'))!.value).toBe(40)
    expect(await dbx.products.get('p9')).toBeTruthy()
    expect(await dbx.products.get('p1')).toBeUndefined()
  })

  it('restoreBackup (snapshot cloud) không xóa syncQueue', async () => {
    await dbx.syncQueue.add(remoteOp('stock.adjust', { productId: 'p1', delta: 1, reason: 'pending' }))
    await restoreBackup(emptyBackup())
    expect(await dbx.syncQueue.count()).toBe(1)
  })
})
