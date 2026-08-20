import { beforeEach, describe, expect, it } from 'vitest'
import { dbx, setCurrentUser } from '@/core/db'
import {
  changePassword,
  createUser,
  getLoginAttemptState,
  hashPassword,
  login,
  minimumPasswordLength,
  passwordHashNeedsUpgrade,
  passwordMeetsPolicy,
  userForSync,
  verifyPassword,
} from '@/core/domain/auth'
import { applyOps } from '@/core/sync/apply'
import { initSyncEngine, makeOp } from '@/core/sync/engine'
import type { SyncOp, User } from '@/core/types'

beforeEach(async () => {
  await Promise.all([
    dbx.users.clear(), dbx.meta.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(),
  ])
  await initSyncEngine()
})

describe('password KDF and policy', () => {
  it('tạo PBKDF2 versioned và xác minh đúng mật khẩu', async () => {
    const hash = await hashPassword('owner-pass', '00112233445566778899aabbccddeeff')
    expect(hash).toMatch(/^pbkdf2-sha256\$\d+\$[0-9a-f]{64}$/)
    expect(passwordHashNeedsUpgrade(hash)).toBe(false)
    expect(await verifyPassword('owner-pass', '00112233445566778899aabbccddeeff', hash)).toBe(true)
    expect(await verifyPassword('wrong-pass', '00112233445566778899aabbccddeeff', hash)).toBe(false)
  })

  it('áp chính sách 8 ký tự cho privileged và 6 cho staff', () => {
    expect(minimumPasswordLength('owner')).toBe(8)
    expect(minimumPasswordLength('admin')).toBe(8)
    expect(minimumPasswordLength('staff')).toBe(6)
    expect(passwordMeetsPolicy('123456', 'staff')).toBe(true)
    expect(passwordMeetsPolicy('123456', 'owner')).toBe(false)
  })
})

describe('login throttling', () => {
  it('khóa tạm sau 5 lần sai và xóa bộ đếm khi đăng nhập đúng', async () => {
    const owner = await createUser({
      username: 'owner', name: 'Chủ', password: 'owner-pass', role: 'owner',
    })
    for (let i = 0; i < 5; i += 1) {
      await expect(login('owner', 'wrong-pass')).rejects.toThrow(/Sai tên/)
    }
    const state = await getLoginAttemptState('owner')
    expect(state.failures).toBe(5)
    expect(state.lockedUntil).toBeGreaterThan(Date.now())
    await expect(login('owner', 'owner-pass')).rejects.toThrow(/tạm khóa/)

    await dbx.meta.delete('auth:login:owner')
    await expect(login('owner', 'owner-pass')).resolves.toMatchObject({ id: owner.id })
    expect((await getLoginAttemptState('owner')).failures).toBe(0)
  })
})

describe('privileged verifier isolation', () => {
  it('user.upsert không đưa verifier owner/admin vào payload cloud', async () => {
    const owner = await createUser({
      username: 'owner', name: 'Chủ', password: 'owner-pass', role: 'owner',
    })
    const op = (await dbx.syncQueue.toArray()).find((row) => row.type === 'user.upsert')!
    const synced = (op.payload as { user: User }).user
    expect(owner.passwordHash).toMatch(/^pbkdf2-sha256\$/)
    expect(synced.passwordHash).toBe('')
    expect(synced.salt).toBe('')
    expect(synced.passwordNeedsReset).toBe(true)
    expect(userForSync(owner).passwordHash).toBe('')
  })

  it('staff verifier vẫn đồng bộ để nhân viên đăng nhập offline trên thiết bị đã ghép', async () => {
    const owner = await createUser({
      username: 'owner', name: 'Chủ', password: 'owner-pass', role: 'owner',
    })
    await setCurrentUser(owner)
    const staff = await createUser({
      username: 'staff', name: 'NV', password: '123456', role: 'staff',
    })
    const op = (await dbx.syncQueue.toArray())
      .filter((row) => row.type === 'user.upsert')
      .find((row) => (row.payload as { user: User }).user.id === staff.id)!
    expect((op.payload as { user: User }).user.passwordHash).toBe(staff.passwordHash)
  })

  it('đổi mật khẩu owner phát lệnh xóa verifier trên máy khác', async () => {
    const owner = await createUser({
      username: 'owner', name: 'Chủ', password: 'owner-pass', role: 'owner',
    })
    await setCurrentUser(owner)
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await changePassword(owner.id, 'owner-new-pass')
    const op = (await dbx.syncQueue.toArray()).find((row) => row.type === 'user.password')!
    expect(op.payload).toMatchObject({ userId: owner.id, clearVerifier: true })
  })

  it('user.upsert remote không trồng hash owner; giữ verifier local', async () => {
    const owner = await createUser({
      username: 'owner', name: 'Chủ', password: 'owner-pass', role: 'owner',
    })
    const localHash = owner.passwordHash
    const op: SyncOp = {
      ...makeOp('user.upsert', {
        user: { ...owner, name: 'Tên từ máy khác', passwordHash: 'stolen-hash', salt: 'stolen-salt' },
      }),
      deviceId: 'remote-device',
    }
    await applyOps([op])
    const after = (await dbx.users.get(owner.id))!
    expect(after.name).toBe('Tên từ máy khác')
    expect(after.passwordHash).toBe(localHash)
    expect(after.salt).toBe(owner.salt)
  })

  it('user.password remote mang hash owner bị bỏ, không ghi đè', async () => {
    const owner = await createUser({
      username: 'owner', name: 'Chủ', password: 'owner-pass', role: 'owner',
    })
    const localHash = owner.passwordHash
    const op: SyncOp = {
      ...makeOp('user.password', {
        userId: owner.id, passwordHash: 'evil-hash', salt: 'evil-salt', passwordNeedsReset: false,
      }),
      deviceId: 'remote-device',
    }
    await applyOps([op])
    const after = (await dbx.users.get(owner.id))!
    expect(after.passwordHash).toBe(localHash)
    expect(after.salt).toBe(owner.salt)
  })

  it('máy mới nhận user.upsert owner có hash thì vẫn redacted', async () => {
    const incoming: User = {
      id: 'owner-remote', username: 'remote', name: 'Chủ remote', email: '', role: 'owner',
      passwordHash: 'planted-hash', salt: 'planted-salt', passwordNeedsReset: false,
      perms: { all: true }, active: true, createdAt: 1, updatedAt: 1,
    }
    const op: SyncOp = {
      ...makeOp('user.upsert', { user: incoming }),
      deviceId: 'remote-device',
    }
    await applyOps([op])
    const after = (await dbx.users.get(incoming.id))!
    expect(after.passwordHash).toBe('')
    expect(after.salt).toBe('')
    expect(after.passwordNeedsReset).toBe(true)
  })

  it('remote clearVerifier làm verifier privileged không còn dùng được', async () => {
    const remote: User = {
      id: 'owner-remote', username: 'remote', name: 'Chủ remote', email: '', role: 'owner',
      passwordHash: 'legacy-secret-hash', salt: 'legacy-salt', passwordNeedsReset: false,
      perms: { all: true }, active: true, createdAt: 1, updatedAt: 1,
    }
    await dbx.users.put(remote)
    const op: SyncOp = {
      ...makeOp('user.password', {
        userId: remote.id,
        clearVerifier: true,
        passwordNeedsReset: true,
        updatedAt: 2,
      }),
      deviceId: 'remote-device',
    }
    await applyOps([op])
    const after = (await dbx.users.get(remote.id))!
    expect(after.passwordHash).toBe('')
    expect(after.salt).toBe('')
    expect(after.passwordNeedsReset).toBe(true)
  })
})
