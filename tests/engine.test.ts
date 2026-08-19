import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { dbx, getMeta, setMeta } from '@/core/db'
import { initSyncEngine, enqueueOp, makeOp, flushQueue, setTransport, setSyncMode, setCloudPaused, getSyncState } from '@/core/sync/engine'
import { compareHlc } from '@/core/sync/hlc'
import { nullTransport } from '@/core/sync/transport'
import type { SyncOp } from '@/core/types'

describe('engine v2 — outbox', () => {
  beforeEach(async () => {
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await dbx.products.clear()
    await dbx.meta.clear()
    await initSyncEngine()
    setSyncMode('local')
    setTransport(nullTransport)
  })

  afterEach(() => {
    setCloudPaused(false)
    setSyncMode('local')
    setTransport(nullTransport)
  })

  it('enqueueOp ghi CẢ syncQueue lẫn appliedOps, id = hlc, có deviceId', async () => {
    const op = await enqueueOp('stock.adjust', { productId: 'p1', delta: 5, reason: 'init' })
    expect(op.id).toBe(op.hlc)
    expect(op.deviceId).toBeTruthy()
    expect(await dbx.syncQueue.get(op.id)).toBeTruthy()
    expect(await dbx.appliedOps.get(op.id)).toBeTruthy()
  })

  it('hlc các op tăng nghiêm ngặt', async () => {
    const a = makeOp('note.delete', { noteId: 'n1' })
    const b = makeOp('note.delete', { noteId: 'n2' })
    expect(compareHlc(b.hlc, a.hlc)).toBe(1)
  })

  it('enqueueOp hoạt động BÊN TRONG transaction của caller (outbox pattern)', async () => {
    await dbx.transaction('rw', [dbx.products, dbx.syncQueue, dbx.appliedOps], async () => {
      await dbx.products.put({ id: 'p9', name: 'X', cat: 'Khác', price: 1, cost: 1, stock: 0, unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0, batches: [], createdAt: 1, updatedAt: 1 })
      await enqueueOp('product.upsert', { product: { id: 'p9' } })
    })
    expect(await dbx.syncQueue.count()).toBe(1)
  })
})

describe('engine v2 — lastSeq là mốc đã áp, không phải MAX cloud', () => {
  beforeEach(async () => {
    await Promise.all([dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.products.clear(), dbx.meta.clear(), dbx.stockMoves.clear()])
    await initSyncEngine()
    setSyncMode('local')
    setTransport(nullTransport)
  })

  afterEach(() => {
    setCloudPaused(false)
    setSyncMode('local')
    setTransport(nullTransport)
  })

  it('sau push, vẫn kéo op máy kia nằm giữa lastSeq cũ và seq cloud', async () => {
    await dbx.products.put({
      id: 'p1', name: 'SP', cat: 'Khác', price: 1, cost: 1, stock: 10, unit: 'cái',
      barcode: '', expiry: '', units: [], wholesalePrice: 0, batches: [], createdAt: 1, updatedAt: 1,
    })
    await setMeta('sync:lastSeq', 10)

    const remote: SyncOp = {
      ...makeOp('stock.adjust', { productId: 'p1', delta: -3, reason: 'máy kia' }),
      deviceId: 'dev_remote',
    }
    remote.id = remote.hlc

    await enqueueOp('stock.adjust', { productId: 'p1', delta: 1, reason: 'máy mình' })

    let pulledSince = -1
    setSyncMode('sync')
    setTransport({
      ...nullTransport,
      async pushOps(ops) {
        return { acked: ops.map((o) => o.id), seq: 15 }
      },
      async pullOps(since) {
        pulledSince = since
        if (since < 15) return { ops: [remote], seq: 15 }
        return { ops: [], seq: 15 }
      },
    })

    await flushQueue()

    expect(pulledSince).toBe(10)
    expect((await dbx.products.get('p1'))!.stock).toBe(7)
    expect(await dbx.appliedOps.get(remote.id)).toBeTruthy()
    expect(await getMeta<number>('sync:lastSeq', 0)).toBe(15)
  })

  it('pull một trang không nhảy lastSeq tới MAX cloud', async () => {
    await dbx.products.put({
      id: 'p1', name: 'SP', cat: 'Khác', price: 1, cost: 1, stock: 10, unit: 'cái',
      barcode: '', expiry: '', units: [], wholesalePrice: 0, batches: [], createdAt: 1, updatedAt: 1,
    })
    await setMeta('sync:lastSeq', 10)
    const remote = {
      ...makeOp('stock.adjust', { productId: 'p1', delta: -1, reason: 'trang 1' }),
      deviceId: 'dev_remote',
      seq: 11,
    }
    remote.id = remote.hlc

    setSyncMode('sync')
    setTransport({
      ...nullTransport,
      async pullOps(since) {
        if (since < 11) return { ops: [remote], seq: 99 }
        return { ops: [], seq: 99 }
      },
    })

    await flushQueue()

    expect((await dbx.products.get('p1'))!.stock).toBe(9)
    expect(await getMeta<number>('sync:lastSeq', 0)).toBe(11)
  })

  it('shop mới lastSeq=0, máy trống, cloud trống: không đẩy snapshot rỗng, không đỏ badge', async () => {
    await setMeta('sync:lastSeq', 0)
    let pushed = 0
    setSyncMode('sync')
    setTransport({
      ...nullTransport,
      async pullSnapshot() { return null },
      async pushSnapshot() { pushed += 1 },
      async pullOps() { return { ops: [], seq: 0 } },
    })

    await flushQueue()

    expect(pushed).toBe(0)
    expect(getSyncState().status).toBe('ok')
    expect(getSyncState().error).toBeNull()
  })

  it('shop mới lastSeq=0, có SP local, cloud trống: đẩy snapshot local', async () => {
    await dbx.sales.clear()
    await dbx.products.put({
      id: 'p1', name: 'SP', cat: 'Khác', price: 1, cost: 1, stock: 10, unit: 'cái',
      barcode: '', expiry: '', units: [], wholesalePrice: 0, batches: [], createdAt: 1, updatedAt: 1,
    })
    await setMeta('sync:lastSeq', 0)
    let pushed = 0
    setSyncMode('sync')
    setTransport({
      ...nullTransport,
      async pullSnapshot() { return null },
      async pushSnapshot() { pushed += 1 },
      async pullOps() { return { ops: [], seq: 0 } },
    })

    await flushQueue()

    expect(pushed).toBe(1)
    expect(getSyncState().status).toBe('ok')
  })

  it('sync mode gap ≥ 20: đẩy snapshot kể cả outbox rỗng', async () => {
    await setMeta('sync:lastSeq', 192)
    await setMeta('sync:lastSnapshotSeq', 20)
    let pushed = 0
    setSyncMode('sync')
    setTransport({
      ...nullTransport,
      async pushSnapshot() { pushed += 1 },
      async pullOps() { return { ops: [], seq: 192 } },
      async pullSnapshot() { return null },
    })

    await flushQueue()

    expect(pushed).toBe(1)
    expect(await getMeta<number>('sync:lastSnapshotSeq', 0)).toBe(192)
  })

  it('sync mode snapshot không xóa op đang chờ trong outbox', async () => {
    await dbx.products.put({
      id: 'p1', name: 'SP', cat: 'Khác', price: 1, cost: 1, stock: 10, unit: 'cái',
      barcode: '', expiry: '', units: [], wholesalePrice: 0, batches: [], createdAt: 1, updatedAt: 1,
    })
    await enqueueOp('stock.adjust', { productId: 'p1', delta: 1, reason: 'treo' })
    await setMeta('sync:lastSeq', 192)
    await setMeta('sync:lastSnapshotSeq', 20)
    setSyncMode('sync')
    setTransport({
      ...nullTransport,
      async pushOps() { return { acked: [], seq: 192 } },
      async pushSnapshot() { /* */ },
      async pullOps() { return { ops: [], seq: 192 } },
    })

    await flushQueue()

    expect(await dbx.syncQueue.count()).toBe(1)
  })

  it('cloud:paused: flushQueue không đẩy op dù mode vẫn sync', async () => {
    await enqueueOp('stock.adjust', { productId: 'p1', delta: 1, reason: 'ngắt' })
    await setMeta('cloud:paused', true)
    await initSyncEngine()
    let pushed = 0
    setSyncMode('sync')
    setTransport({
      ...nullTransport,
      async pushOps() {
        pushed += 1
        return { acked: [], seq: 1 }
      },
      async pullOps() { return { ops: [], seq: 0 } },
    })

    await flushQueue()

    expect(pushed).toBe(0)
    expect(await dbx.syncQueue.count()).toBe(1)
    expect(getSyncState().status).toBe('offline')
  })
})
