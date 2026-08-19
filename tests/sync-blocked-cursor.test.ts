import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dbx, getMeta, setMeta } from '@/core/db'
import { getBlockedOps } from '@/core/sync/apply'
import {
  flushQueue,
  getSyncState,
  initSyncEngine,
  makeOp,
  setCloudPaused,
  setSyncMode,
  setTransport,
} from '@/core/sync/engine'
import { nullTransport } from '@/core/sync/transport'
import type { Product, Sale, SyncOp } from '@/core/types'

function sale(productId: string): Sale {
  return {
    id: 'sale-blocked',
    items: [{ productId, name: 'SP', qty: 1, price: 10000, cost: 6000, unit: 'cái', unitRatio: 1 }],
    total: 10000, profit: 4000, discount: 0, payMethod: 'cash',
    tendered: 10000, change: 0, debtAmount: 0, customerId: null,
    date: new Date().toISOString(),
  }
}

function product(id: string): Product {
  return {
    id, name: 'SP', cat: 'Khác', price: 10000, cost: 6000, stock: 5,
    unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: 1, updatedAt: 1,
  }
}

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(), dbx.stockMoves.clear(),
    dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
  ])
  await initSyncEngine()
  setCloudPaused(false)
  setSyncMode('sync')
})

afterEach(() => {
  setCloudPaused(false)
  setSyncMode('local')
  setTransport(nullTransport)
})

describe('blocked remote dependency', () => {
  it('không tiến cursor; sau khi dependency có mặt thì retry thành công', async () => {
    await setMeta('sync:lastSeq', 10)
    const remote: SyncOp & { seq: number } = {
      ...makeOp('sale.commit', sale('p-late')),
      deviceId: 'dev-remote',
      seq: 11,
    }

    setTransport({
      ...nullTransport,
      async pullOps(since) {
        return since < 11 ? { ops: [remote], seq: 11 } : { ops: [], seq: 11 }
      },
    })

    await flushQueue()

    expect(getSyncState().status).toBe('error')
    expect(await getMeta<number>('sync:lastSeq', 0)).toBe(10)
    expect(await dbx.appliedOps.get(remote.id)).toBeUndefined()
    expect((await getBlockedOps()).some((op) => op.id === remote.id)).toBe(true)

    await dbx.products.put(product('p-late'))
    await flushQueue()

    expect(getSyncState().status).toBe('ok')
    expect(await getMeta<number>('sync:lastSeq', 0)).toBe(11)
    expect(await dbx.appliedOps.get(remote.id)).toBeTruthy()
    expect(await dbx.sales.get('sale-blocked')).toBeTruthy()
    expect((await getBlockedOps()).some((op) => op.id === remote.id)).toBe(false)
  })
})
