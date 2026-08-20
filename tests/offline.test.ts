import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { gcAppliedOps, setAppliedOpsGcWatermark } from '@/core/sync/engine'
import { withExclusiveLock } from '@/core/offline'

describe('offline / gc', () => {
  beforeEach(async () => {
    await Promise.all([dbx.appliedOps.clear(), dbx.meta.clear()])
  })

  it('gcAppliedOps chỉ xóa theo watermark server, không theo tuổi cục bộ', async () => {
    const oldMs = Date.now() - 40 * 86_400_000
    const freshMs = Date.now() - 2 * 86_400_000
    await dbx.appliedOps.bulkAdd([
      { id: `${oldMs}-0001-dev` },
      { id: `${freshMs}-0001-dev` },
    ])

    expect(await gcAppliedOps()).toBe(0)
    expect(await dbx.appliedOps.count()).toBe(2)

    await setAppliedOpsGcWatermark(freshMs)
    expect(await gcAppliedOps()).toBe(1)
    expect(await dbx.appliedOps.get(`${oldMs}-0001-dev`)).toBeUndefined()
    expect(await dbx.appliedOps.get(`${freshMs}-0001-dev`)).toBeTruthy()
  })

  it('withExclusiveLock chạy fn khi không có Web Locks', async () => {
    const v = await withExclusiveLock('t', async () => 42)
    expect(v).toBe(42)
  })
})
