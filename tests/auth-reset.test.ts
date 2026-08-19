/**
 * NV mới phải đổi mật khẩu; chủ cửa hàng thì không.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx, setCurrentUser } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import { changePassword, createUser, login } from '@/core/domain/auth'

beforeEach(async () => {
  await dbx.transaction('rw', [dbx.users, dbx.meta, dbx.syncQueue, dbx.appliedOps], async () => {
    await dbx.users.clear()
    await dbx.meta.clear()
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
  })
  await initSyncEngine()
})

describe('passwordNeedsReset', () => {
  it('chủ cửa hàng không bắt đổi', async () => {
    const u = await createUser({ username: 'chu', name: 'Chủ', password: '1234', role: 'owner' })
    expect(u.passwordNeedsReset).toBe(false)
  })

  it('nhân viên mới phải đổi mật khẩu', async () => {
    const owner = await createUser({ username: 'chu', name: 'Chủ', password: '1234', role: 'owner' })
    await setCurrentUser(owner)
    const u = await createUser({ username: 'nv1', name: 'An', password: '1111', role: 'staff' })
    await setCurrentUser(null)

    expect(u.passwordNeedsReset).toBe(true)
    const logged = await login('nv1', '1111')
    expect(logged.passwordNeedsReset).toBe(true)
    await changePassword(u.id, '2222')
    const after = await login('nv1', '2222')
    expect(after.passwordNeedsReset).toBe(false)
  })
})
