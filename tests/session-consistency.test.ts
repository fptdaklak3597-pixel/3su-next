import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dbx, getCurrentUser, setCurrentUser } from '@/core/db'
import {
  startCurrentUserSessionSync,
  stopCurrentUserSessionSync,
} from '@/core/session'
import { useApp } from '@/core/store'
import type { User } from '@/core/types'

function user(over: Partial<User> = {}): User {
  return {
    id: 'u1', username: 'staff', name: 'Nhân viên', email: '', role: 'staff',
    passwordHash: 'hash', salt: 'salt', passwordNeedsReset: false,
    perms: { sell: true }, active: true, createdAt: 1, updatedAt: 1,
    ...over,
  }
}

beforeEach(async () => {
  stopCurrentUserSessionSync()
  useApp.getState().setUser(null)
  await Promise.all([dbx.users.clear(), dbx.meta.clear()])
})

afterEach(() => {
  stopCurrentUserSessionSync()
  useApp.getState().setUser(null)
})

describe('stable local session identity', () => {
  it('setCurrentUser chỉ lưu stable ID, không lưu object/hash', async () => {
    const current = user()
    await dbx.users.put(current)
    await setCurrentUser(current)

    const row = await dbx.meta.get('currentUser')
    expect(row?.value).toBe(current.id)
    expect(JSON.stringify(row?.value)).not.toContain('passwordHash')
    expect(await getCurrentUser()).toEqual(current)
  })

  it('reader luôn trả record mới nhất sau đổi role/perms', async () => {
    const current = user()
    await dbx.users.put(current)
    await setCurrentUser(current)
    await dbx.users.update(current.id, {
      role: 'admin',
      perms: { all: true },
      name: 'Quản trị mới',
      updatedAt: 2,
    })

    expect(await getCurrentUser()).toMatchObject({
      id: current.id,
      role: 'admin',
      perms: { all: true },
      name: 'Quản trị mới',
      updatedAt: 2,
    })
  })

  it('migrate session object legacy sang ID và không tin role cache cũ', async () => {
    const cached = user({ role: 'admin', perms: { all: true }, passwordHash: 'cached-secret' })
    const fresh = user({ role: 'staff', perms: { sell: true }, passwordHash: 'fresh-hash', updatedAt: 3 })
    await dbx.users.put(fresh)
    await dbx.meta.put({ key: 'currentUser', value: cached })

    expect(await getCurrentUser()).toEqual(fresh)
    expect((await dbx.meta.get('currentUser'))?.value).toBe(fresh.id)
  })

  it('user bị khóa, xóa mềm hoặc mất record sẽ mất session', async () => {
    const current = user()
    await dbx.users.put(current)
    await setCurrentUser(current)

    await dbx.users.update(current.id, { active: false })
    expect(await getCurrentUser()).toBeNull()
    expect(await dbx.meta.get('currentUser')).toBeUndefined()

    await dbx.users.put(user({ active: true, deleted: true }))
    await dbx.meta.put({ key: 'currentUser', value: current.id })
    expect(await getCurrentUser()).toBeNull()

    await dbx.users.clear()
    await dbx.meta.put({ key: 'currentUser', value: current.id })
    expect(await getCurrentUser()).toBeNull()
  })

  it('từ chối tạo session cho record không hoạt động', async () => {
    const disabled = user({ active: false })
    await dbx.users.put(disabled)
    await expect(setCurrentUser(disabled)).rejects.toThrow(/không hoạt động/)
    expect(await dbx.meta.get('currentUser')).toBeUndefined()
  })
})

describe('live Zustand session synchronization', () => {
  it('cập nhật quyền và tự đăng xuất khi record thay đổi', async () => {
    const current = user()
    await dbx.users.put(current)
    await setCurrentUser(current)
    startCurrentUserSessionSync()

    await vi.waitFor(() => {
      expect(useApp.getState().user).toMatchObject({ id: current.id, role: 'staff' })
    })

    await dbx.users.update(current.id, {
      role: 'admin',
      perms: { all: true },
      updatedAt: 2,
    })
    await vi.waitFor(() => {
      expect(useApp.getState().user).toMatchObject({ role: 'admin', perms: { all: true } })
    })

    await dbx.users.update(current.id, { active: false, updatedAt: 3 })
    await vi.waitFor(() => {
      expect(useApp.getState().user).toBeNull()
    })
    expect(await dbx.meta.get('currentUser')).toBeUndefined()
  })
})
