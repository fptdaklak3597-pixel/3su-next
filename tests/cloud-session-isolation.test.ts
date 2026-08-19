import { beforeEach, describe, expect, it } from 'vitest'
import { dbx, getCurrentUser, getMeta, setCurrentUser, setMeta } from '@/core/db'
import {
  assertTenantBinding,
  clearCloudSession,
  CloudTenantConflictError,
  normalizeApiBaseOverride,
  selectShopForSession,
  type CloudShopRow,
} from '@/core/sync/cloud'
import { initSyncEngine } from '@/core/sync/engine'
import type { User } from '@/core/types'

const shops: CloudShopRow[] = [
  { shopId: 'shop-a', name: 'A', role: 'owner' },
  { shopId: 'shop-b', name: 'B', role: 'staff' },
]

beforeEach(async () => {
  await Promise.all([
    dbx.meta.clear(),
    dbx.users.clear(),
    dbx.syncQueue.clear(),
    dbx.appliedOps.clear(),
  ])
  await initSyncEngine()
})

describe('cloud shop selection', () => {
  it('không tự chọn shop đầu tiên khi tài khoản có nhiều shop', () => {
    expect(selectShopForSession(shops, null, null)).toBeNull()
  })

  it('dữ liệu đã gắn shop nào thì shop đó thắng remembered binding', () => {
    expect(selectShopForSession(shops, 'shop-b', 'shop-a')?.shopId).toBe('shop-a')
  })

  it('chỉ tự chọn khi tài khoản có đúng một shop', () => {
    expect(selectShopForSession([shops[1]!], null, null)?.shopId).toBe('shop-b')
  })

  it('không mở app nếu data shop không còn trong membership', () => {
    expect(selectShopForSession([shops[1]!], 'shop-b', 'shop-a')).toBeNull()
  })
})

describe('tenant binding invariant', () => {
  it('cho phép bind lần đầu và bind lại đúng shop', () => {
    expect(() => assertTenantBinding(null, 'shop-a')).not.toThrow()
    expect(() => assertTenantBinding('shop-a', 'shop-a')).not.toThrow()
  })

  it('chặn nối dữ liệu hiện tại sang shop khác', () => {
    expect(() => assertTenantBinding('shop-a', 'shop-b')).toThrow(CloudTenantConflictError)
    expect(() => assertTenantBinding('shop-a', 'shop-b')).toThrow(/không thể nối sang/)
  })
})

describe('API base override policy', () => {
  it('production luôn bỏ qua override', () => {
    expect(normalizeApiBaseOverride('https://attacker.example', true)).toBe('')
  })

  it('development chỉ cho HTTPS hoặc HTTP localhost', () => {
    expect(normalizeApiBaseOverride('https://api.example.com/', false)).toBe('https://api.example.com')
    expect(normalizeApiBaseOverride('http://127.0.0.1:8787/', false)).toBe('http://127.0.0.1:8787')
    expect(() => normalizeApiBaseOverride('http://attacker.example', false)).toThrow(/HTTPS/)
    expect(() => normalizeApiBaseOverride('https://u:p@api.example.com', false)).toThrow(/không được chứa/)
    expect(() => normalizeApiBaseOverride('https://api.example.com/?token=x', false)).toThrow(/không được chứa/)
  })
})

describe('cloud logout cleanup', () => {
  it('xóa cloud identity và local actor nhưng giữ khóa tenant dữ liệu', async () => {
    const owner: User = {
      id: 'u1', username: 'owner', name: 'Chủ', email: '', role: 'owner',
      passwordHash: 'h', salt: 's', perms: { all: true }, active: true,
      createdAt: 1, updatedAt: 1,
    }
    await dbx.users.put(owner)
    await setCurrentUser(owner)
    await setMeta('cloud:shopId', 'shop-a')
    await setMeta('cloud:role', 'owner')
    await setMeta('cloud:uid', 'firebase-a')
    await setMeta('cloud:license', { status: 'active', expiresAt: null })
    await setMeta('cloud:paused', true)
    await setMeta('data:shopId', 'shop-a')

    await clearCloudSession()

    expect(await getCurrentUser()).toBeNull()
    expect(await getMeta('cloud:shopId', null)).toBeNull()
    expect(await getMeta('cloud:role', null)).toBeNull()
    expect(await getMeta('cloud:uid', null)).toBeNull()
    expect(await getMeta('cloud:license', null)).toBeNull()
    expect(await getMeta('cloud:paused', true)).toBe(false)
    expect(await getMeta('data:shopId', null)).toBe('shop-a')
  })
})
