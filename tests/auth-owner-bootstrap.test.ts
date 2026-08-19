import { beforeEach, describe, expect, it } from 'vitest'
import { dbx } from '@/core/db'
import { createUser } from '@/core/domain/auth'
import { initSyncEngine } from '@/core/sync/engine'

beforeEach(async () => {
  await Promise.all([
    dbx.users.clear(),
    dbx.syncQueue.clear(),
    dbx.appliedOps.clear(),
    dbx.meta.clear(),
  ])
  await initSyncEngine()
})

describe('owner bootstrap', () => {
  it('cho phép tạo owner đầu tiên khi bảng user hoàn toàn trống', async () => {
    const owner = await createUser({
      username: 'owner',
      name: 'Chủ cửa hàng',
      password: '1234',
      role: 'owner',
    })

    expect(owner.role).toBe('owner')
    expect(await dbx.users.count()).toBe(1)
  })

  it('từ chối tạo owner thứ hai', async () => {
    await createUser({ username: 'owner', name: 'Chủ', password: '1234', role: 'owner' })

    await expect(createUser({
      username: 'owner2',
      name: 'Chủ giả',
      password: '5678',
      role: 'owner',
    })).rejects.toThrow(/chỉ được tạo/)

    expect(await dbx.users.count()).toBe(1)
  })

  it('không mở lại bootstrap khi user cũ đã bị xóa mềm', async () => {
    const owner = await createUser({ username: 'owner', name: 'Chủ', password: '1234', role: 'owner' })
    await dbx.users.update(owner.id, { deleted: true, active: false })

    await expect(createUser({
      username: 'new-owner',
      name: 'Chủ mới',
      password: '5678',
      role: 'owner',
    })).rejects.toThrow(/chỉ được tạo/)

    expect(await dbx.users.count()).toBe(1)
  })

  it('vẫn cho phép owner hiện hữu tạo tài khoản không phải owner qua luồng quản lý', async () => {
    await createUser({ username: 'owner', name: 'Chủ', password: '1234', role: 'owner' })
    const staff = await createUser({ username: 'staff', name: 'Nhân viên', password: '5678', role: 'staff' })

    expect(staff.role).toBe('staff')
    expect(await dbx.users.count()).toBe(2)
  })
})
