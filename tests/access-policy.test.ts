import { describe, expect, it } from 'vitest'
import { canAccessFeature } from '@/core/domain/access'
import type { User } from '@/core/types'

function user(over: Partial<User> = {}): User {
  return {
    id: 'u1',
    username: 'staff',
    name: 'Nhân viên',
    email: '',
    role: 'staff',
    passwordHash: 'hash',
    salt: 'salt',
    perms: {},
    active: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

describe('canAccessFeature', () => {
  it('cho phép bootstrap khi DB user hoàn toàn trống', () => {
    expect(canAccessFeature(null, 'settings', 0)).toBe(true)
  })

  it('không cho user rỗng vượt guard khi DB đã có tài khoản', () => {
    expect(canAccessFeature(null, 'settings', 1)).toBe(false)
  })

  it('owner và admin có toàn quyền', () => {
    expect(canAccessFeature(user({ role: 'owner' }), 'users', 1)).toBe(true)
    expect(canAccessFeature(user({ role: 'admin' }), 'settings', 1)).toBe(true)
  })

  it('staff chỉ được mở tính năng đã cấp', () => {
    const staff = user({ perms: { sell: true } })
    expect(canAccessFeature(staff, 'sell', 1)).toBe(true)
    expect(canAccessFeature(staff, 'inventory', 1)).toBe(false)
  })

  it('quyền all và dev preview cho phép truy cập', () => {
    expect(canAccessFeature(user({ perms: { all: true } }), 'reports', 1)).toBe(true)
    expect(canAccessFeature(null, 'settings', 1, true)).toBe(true)
  })
})
