import { beforeEach, describe, expect, it } from 'vitest'
import { dbx, setMeta } from '@/core/db'
import {
  getAuthoritativeMoneyStockCached,
  resetAuthoritativeMoneyStockCacheForTests,
  setAuthoritativeMoneyStockEnabled,
  warmAuthoritativeMoneyStockCache,
} from '@/core/authoritative/flag'
import { enqueueOp, initSyncEngine } from '@/core/sync/engine'

describe('authoritative flag cache', () => {
  beforeEach(async () => {
    resetAuthoritativeMoneyStockCacheForTests()
    await dbx.meta.clear()
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await dbx.products.clear()
    await initSyncEngine({ deviceId: 'test-dev' })
  })

  it('enqueueOp trong txn không có meta vẫn OK khi flag đã warm', async () => {
    await setAuthoritativeMoneyStockEnabled(false)
    await warmAuthoritativeMoneyStockCache()
    expect(getAuthoritativeMoneyStockCached()).toBe(false)

    await dbx.transaction('rw', [dbx.products, dbx.syncQueue, dbx.appliedOps], async () => {
      await enqueueOp('product.upsert', { product: { id: 'p1' } })
    })
    expect(await dbx.syncQueue.count()).toBe(1)
  })

  it('set flag cập nhật cache sync', async () => {
    await setAuthoritativeMoneyStockEnabled(true)
    expect(getAuthoritativeMoneyStockCached()).toBe(true)
  })

  it('BroadcastChannel cập nhật cache khi tab khác đổi flag', async () => {
    await warmAuthoritativeMoneyStockCache()
    expect(getAuthoritativeMoneyStockCached()).toBe(false)

    if (typeof BroadcastChannel === 'undefined') {
      return
    }
    const peer = new BroadcastChannel('3su-db')
    peer.postMessage({ t: 'authoritativeFlag', on: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(getAuthoritativeMoneyStockCached()).toBe(true)
    peer.close()
  })
})
