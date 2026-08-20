import { beforeEach, describe, expect, it } from 'vitest'
import {
  dbx,
  DEFAULT_SETTINGS,
  getMeta,
  restoreLocalBackup,
  type BackupData,
} from '@/core/db'
import {
  flushQueue,
  gcAppliedOps,
  getAppliedOpsGcWatermark,
  initSyncEngine,
  setAppliedOpsGcWatermark,
  setCloudPaused,
  setSyncMode,
  setTransport,
} from '@/core/sync/engine'
import { nullTransport } from '@/core/sync/transport'

function opId(ms: number, counter = 0): string {
  return `${String(ms).padStart(13, '0')}-${String(counter).padStart(4, '0')}-device`
}

function emptyBackup(): BackupData {
  return {
    version: 6,
    exportedAt: new Date().toISOString(),
    credentialPolicy: 'excluded',
    shop: { name: 'Shop', phone: '', address: '' },
    settings: DEFAULT_SETTINGS,
    products: [], sales: [], customers: [], debtPayments: [], goodsReceipts: [],
    stockMoves: [], stocktakes: [], suppliers: [], supplierPayments: [], users: undefined,
    purchaseOrders: [], invoices: [], batches: [], priceLog: [], notes: [],
    pricingRules: [], quickAnswers: [], devices: [],
  }
}

beforeEach(async () => {
  setCloudPaused(false)
  setSyncMode('local')
  setTransport(nullTransport)
  await Promise.all([dbx.appliedOps.clear(), dbx.meta.clear(), dbx.syncQueue.clear()])
  await initSyncEngine()
})

describe('applied-op retention watermark', () => {
  it('không tự xóa marker chỉ vì đã cũ khi server chưa xác nhận', async () => {
    await dbx.appliedOps.bulkPut([
      { id: opId(Date.now() - 365 * 86_400_000) },
      { id: opId(Date.now() - 60 * 86_400_000) },
    ])

    expect(await getAppliedOpsGcWatermark()).toBe(0)
    expect(await gcAppliedOps()).toBe(0)
    expect(await dbx.appliedOps.count()).toBe(2)
  })

  it('watermark chỉ tăng và từ chối giá trị sai hoặc ở tương lai', async () => {
    const first = Date.now() - 20_000
    const newer = Date.now() - 10_000

    expect(await setAppliedOpsGcWatermark(first)).toBe(first)
    expect(await setAppliedOpsGcWatermark(first - 1_000)).toBe(first)
    expect(await setAppliedOpsGcWatermark(newer)).toBe(newer)
    expect(await getAppliedOpsGcWatermark()).toBe(newer)

    await expect(setAppliedOpsGcWatermark(0)).rejects.toThrow(/watermark/i)
    await expect(setAppliedOpsGcWatermark(Number.NaN)).rejects.toThrow(/watermark/i)
    await expect(setAppliedOpsGcWatermark(Date.now() + 60_000)).rejects.toThrow(/tương lai/i)
  })

  it('chỉ xóa HLC marker nhỏ hơn watermark; giữ boundary, marker mới và ID legacy', async () => {
    const watermark = Date.now() - 10_000
    const oldId = opId(watermark - 1)
    const boundaryId = opId(watermark)
    const newId = opId(watermark + 1)
    const legacyId = 'legacy-applied-marker'
    await dbx.appliedOps.bulkPut([
      { id: oldId }, { id: boundaryId }, { id: newId }, { id: legacyId },
    ])
    await setAppliedOpsGcWatermark(watermark)

    expect(await gcAppliedOps()).toBe(1)
    expect(await dbx.appliedOps.get(oldId)).toBeUndefined()
    expect(await dbx.appliedOps.get(boundaryId)).toBeTruthy()
    expect(await dbx.appliedOps.get(newId)).toBeTruthy()
    expect(await dbx.appliedOps.get(legacyId)).toBeTruthy()
  })

  it('pull có appliedGcBeforeMs thì tiến watermark và xóa marker cũ', async () => {
    const watermark = Date.now() - 10_000
    const oldId = opId(watermark - 1)
    const keepId = opId(watermark + 1)
    await dbx.appliedOps.bulkPut([{ id: oldId }, { id: keepId }])
    setCloudPaused(false)
    setSyncMode('sync')
    setTransport({
      ...nullTransport,
      async pullOps() {
        return { ops: [], seq: 1, appliedGcBeforeMs: watermark }
      },
    })

    await flushQueue()

    expect(await getAppliedOpsGcWatermark()).toBe(watermark)
    expect(await dbx.appliedOps.get(oldId)).toBeUndefined()
    expect(await dbx.appliedOps.get(keepId)).toBeTruthy()
  })

  it('local restore xóa watermark của tenant cũ', async () => {
    const watermark = Date.now() - 10_000
    await setAppliedOpsGcWatermark(watermark)
    await restoreLocalBackup(emptyBackup())

    expect(await getMeta('sync:appliedGcBeforeMs', 0)).toBe(0)
    expect(await getAppliedOpsGcWatermark()).toBe(0)
  })
})
