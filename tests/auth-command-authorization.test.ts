import { beforeEach, describe, expect, it } from 'vitest'
import { dbx, DEFAULT_SETTINGS, setCurrentUser } from '@/core/db'
import {
  changePassword,
  createUser,
  deleteUser,
  getCurrentActor,
  login,
  requirePermission,
  updateUser,
} from '@/core/domain/auth'
import { saveSettingsSynced } from '@/core/domain/settings'
import { initSyncEngine } from '@/core/sync/engine'
import type { User } from '@/core/types'

let owner: User
let staff: User

beforeEach(async () => {
  await Promise.all([
    dbx.users.clear(),
    dbx.meta.clear(),
    dbx.syncQueue.clear(),
    dbx.appliedOps.clear(),
  ])
  await initSyncEngine()
  owner = await createUser({ username: 'owner', name: 'Chủ', password: 'owner-1234', role: 'owner' })
  await setCurrentUser(owner)
  staff = await createUser({ username: 'staff', name: 'Nhân viên', password: 'staff1', role: 'staff' })
})

describe('actor validation', () => {
  it('đọc record mới nhất thay vì tin object session đã cache', async () => {
    await setCurrentUser(staff)
    await dbx.users.update(staff.id, { active: false })

    expect(await getCurrentActor()).toBeNull()
    await expect(requirePermission('sell', { allowEmptyStore: false })).rejects.toThrow(/không có quyền/)
  })

  it('từ chối command quản lý user khi chưa đăng nhập', async () => {
    await setCurrentUser(null)

    await expect(updateUser(staff.id, { name: 'Đổi trái phép' })).rejects.toThrow(/quản lý người dùng/)
    await expect(deleteUser(staff.id)).rejects.toThrow(/quản lý người dùng/)
  })

  it('staff không có quyền không thể thay đổi user khác hoặc settings', async () => {
    await setCurrentUser(staff)

    await expect(updateUser(owner.id, { name: 'Chiếm quyền' })).rejects.toThrow(/quản lý người dùng/)
    await expect(changePassword(owner.id, 'owner-9999')).rejects.toThrow(/không có quyền/)
    await expect(saveSettingsSynced({ ...DEFAULT_SETTINGS, lowStock: 99 })).rejects.toThrow(/không có quyền/)
  })
})

describe('user management invariants', () => {
  it('owner có thể sửa staff nhưng không thể xóa owner', async () => {
    await updateUser(staff.id, { name: 'Tên mới', perms: { sell: true } })
    expect((await dbx.users.get(staff.id))?.name).toBe('Tên mới')
    expect((await dbx.users.get(staff.id))?.perms.sell).toBe(true)

    await expect(deleteUser(owner.id)).rejects.toThrow(/chủ cửa hàng/i)
  })

  it('không thể nâng tài khoản khác thành owner', async () => {
    await expect(updateUser(staff.id, { role: 'owner' })).rejects.toThrow(/vai trò chủ/)
  })

  it('không thể tự xóa hoặc tự khóa tài khoản đang dùng', async () => {
    await expect(deleteUser(owner.id)).rejects.toThrow(/chủ cửa hàng/i)
    await expect(updateUser(owner.id, { active: false })).rejects.toThrow(/khóa tài khoản chủ/)
  })

  it('admin không được sửa mật khẩu owner', async () => {
    const admin = await createUser({ username: 'admin', name: 'Quản trị', password: 'admin-1111', role: 'admin' })
    await setCurrentUser(admin)

    await expect(changePassword(owner.id, 'owner-2222')).rejects.toThrow(/chủ cửa hàng/i)
  })

  it('user vừa xác thực được đổi mật khẩu của chính mình lần đầu', async () => {
    await setCurrentUser(null)
    await login('staff', 'staff1')
    await changePassword(staff.id, 'staff2')

    await expect(login('staff', 'staff2')).resolves.toMatchObject({ id: staff.id })
  })
})
