import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dbx, getMeta } from '@/core/db'
import {
  flushQueue,
  getSyncState,
  initSyncEngine,
  makeOp,
  setCloudPaused,
  setSyncMode,
  setTransport,
  startSyncLoop,
  stopSyncLoop,
} from '@/core/sync/engine'
import { nullTransport, type SyncTransport } from '@/core/sync/transport'
import type { SyncOp } from '@/core/types'

beforeEach(async () => {
  stopSyncLoop()
  await Promise.all([
    dbx.products.clear(), dbx.sales.clear(), dbx.notes.clear(), dbx.meta.clear(),
    dbx.syncQueue.clear(), dbx.appliedOps.clear(),
  ])
  await initSyncEngine()
  setCloudPaused(false)
  setSyncMode('sync')
  setTransport(nullTransport)
})

afterEach(() => {
  stopSyncLoop()
  setCloudPaused(false)
  setSyncMode('local')
  setTransport(nullTransport)
  vi.restoreAllMocks()
})

describe('sync single-flight', () => {
  it('không chạy hai pull mạng đồng thời; request chen vào chỉ tạo vòng kế tiếp', async () => {
    let active = 0
    let maxActive = 0
    let pullCalls = 0
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })

    const transport: SyncTransport = {
      ...nullTransport,
      async pullOps() {
        pullCalls += 1
        active += 1
        maxActive = Math.max(maxActive, active)
        if (pullCalls === 1) await firstGate
        active -= 1
        return { ops: [], seq: 0 }
      },
    }
    setTransport(transport)

    const first = flushQueue()
    const second = flushQueue()
    releaseFirst()
    await Promise.all([first, second])

    expect(maxActive).toBe(1)
    expect(pullCalls).toBe(2)
    expect(getSyncState().status).toBe('ok')
  })

  it('đóng transport cũ khi thay kết nối', () => {
    const disconnect = vi.fn()
    setTransport({ ...nullTransport, disconnect })
    setTransport({ ...nullTransport })
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})

describe('pull pagination safety', () => {
  it('dừng với trạng thái lỗi khi máy chủ trả lặp cùng một trang đầy', async () => {
    const page: SyncOp[] = Array.from({ length: 500 }, (_, index) => ({
      ...makeOp('note.delete', { noteId: `n-${index}` }),
      deviceId: 'remote-device',
    }))

    setTransport({
      ...nullTransport,
      async pullOps() { return { ops: page, seq: 500 } },
    })

    await flushQueue()

    expect(getSyncState().status).toBe('error')
    expect(getSyncState().error).toMatch(/trả lặp cùng một trang/)
    expect(await getMeta<number>('sync:lastSeq', 0)).toBe(500)
  })

  it('từ chối trang trộn op có seq và không có seq', async () => {
    const a = { ...makeOp('note.delete', { noteId: 'a' }), deviceId: 'remote', seq: 1 }
    const b = { ...makeOp('note.delete', { noteId: 'b' }), deviceId: 'remote' }
    setTransport({
      ...nullTransport,
      async pullOps() { return { ops: [a, b], seq: 2 } },
    })

    await flushQueue()

    expect(getSyncState().status).toBe('error')
    expect(getSyncState().error).toMatch(/trộn op có seq/)
    expect(await getMeta<number>('sync:lastSeq', 0)).toBe(0)
  })
})

describe('sync loop lifecycle', () => {
  it('gỡ đúng online listener khi dừng vòng lặp', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    startSyncLoop()
    const online = add.mock.calls.find(([type]) => type === 'online')
    expect(online).toBeTruthy()
    stopSyncLoop()

    expect(remove).toHaveBeenCalledWith('online', online?.[1])
  })
})
