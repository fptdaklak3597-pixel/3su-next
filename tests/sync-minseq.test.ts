import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dbx, getMeta, setMeta } from '@/core/db'
import { flushQueue, initSyncEngine, needsSnapshotCatchUp, setSyncMode, setTransport } from '@/core/sync/engine'
import { exportSnapshot } from '@/core/sync/snapshot'
import { nullTransport } from '@/core/sync/transport'

describe('needsSnapshotCatchUp', () => {
  it('lỗ seq: lastSeq+1 < minSeq', () => {
    expect(needsSnapshotCatchUp(10, 200)).toBe(true)
    expect(needsSnapshotCatchUp(199, 200)).toBe(false)
    expect(needsSnapshotCatchUp(0, 200)).toBe(false)
    expect(needsSnapshotCatchUp(10, 0)).toBe(false)
    expect(needsSnapshotCatchUp(10, undefined)).toBe(false)
  })
})

describe('pull — minSeq buộc snapshot', () => {
  beforeEach(async () => {
    await Promise.all([
      dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.products.clear(), dbx.meta.clear(),
    ])
    await initSyncEngine()
    setSyncMode('local')
    setTransport(nullTransport)
  })

  afterEach(() => {
    setSyncMode('local')
    setTransport(nullTransport)
  })

  it('lastSeq thấp hơn minSeq còn giữ → kéo snapshot', async () => {
    await setMeta('sync:lastSeq', 10)
    let snapped = false
    setSyncMode('sync')
    setTransport({
      ...nullTransport,
      async pullOps() { return { ops: [], seq: 500, minSeq: 200 } },
      async pullSnapshot() {
        snapped = true
        const exp = await exportSnapshot()
        return { snapshot: exp.snapshot, upToSeq: 200 }
      },
    })
    await flushQueue()
    expect(snapped).toBe(true)
    expect(await getMeta<number>('sync:lastSeq', 0)).toBe(200)
  })
})
