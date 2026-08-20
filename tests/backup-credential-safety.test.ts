import { beforeEach, describe, expect, it } from 'vitest'
import {
  dbx,
  DEFAULT_SETTINGS,
  exportBackup,
  getMeta,
  restoreBackup,
  restoreLocalBackup,
  type BackupData,
} from '@/core/db'
import { getAutoBackups, parseRestoreFile } from '@/core/domain/trial'
import { exportSnapshot } from '@/core/sync/snapshot'
import { initSyncEngine, makeOp, setCloudPaused } from '@/core/sync/engine'
import type { Product, User } from '@/core/types'

function user(over: Partial<User> = {}): User {
  return {
    id: 'u-owner', username: 'owner', name: 'Chủ', email: '', role: 'owner',
    passwordHash: 'pbkdf2-sha256$2000$' + 'a'.repeat(64),
    salt: '00112233445566778899aabbccddeeff', passwordNeedsReset: false,
    perms: { all: true }, active: true, createdAt: 1, updatedAt: 1, ...over,
  }
}

function product(): Product {
  return {
    id: 'p1', name: 'SP backup', cat: 'Khác', price: 10, cost: 5, stock: 2,
    unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: 1, updatedAt: 1,
  }
}

function backup(over: Partial<BackupData> = {}): BackupData {
  return {
    version: 6,
    exportedAt: '2026-08-20T00:00:00.000Z',
    credentialPolicy: 'excluded',
    shop: { name: 'Shop', phone: '', address: '' },
    settings: DEFAULT_SETTINGS,
    products: [], sales: [], customers: [], debtPayments: [], goodsReceipts: [],
    stockMoves: [], stocktakes: [], suppliers: [], supplierPayments: [],
    purchaseOrders: [], invoices: [], batches: [], priceLog: [], notes: [],
    pricingRules: [], quickAnswers: [], devices: [],
    ...over,
  }
}

beforeEach(async () => {
  setCloudPaused(false)
  await Promise.all([
    dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
    dbx.debtPayments.clear(), dbx.goodsReceipts.clear(), dbx.stockMoves.clear(),
    dbx.stocktakes.clear(), dbx.suppliers.clear(), dbx.supplierPayments.clear(),
    dbx.users.clear(), dbx.purchaseOrders.clear(), dbx.invoices.clear(),
    dbx.batches.clear(), dbx.priceLog.clear(), dbx.notes.clear(),
    dbx.pricingRules.clear(), dbx.quickAnswers.clear(), dbx.devices.clear(),
    dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
  ])
  await initSyncEngine()
})

describe('local and automatic backups', () => {
  it('export mặc định không chứa user/hash/salt', async () => {
    await dbx.users.bulkPut([
      user(),
      user({ id: 'u-staff', username: 'staff', role: 'staff', passwordHash: 'staff-hash', salt: 'staff-salt', perms: { sell: true } }),
    ])
    await dbx.products.put(product())

    const data = await exportBackup()
    const json = JSON.stringify(data)

    expect(data.credentialPolicy).toBe('excluded')
    expect(data.version).toBeGreaterThanOrEqual(6)
    expect(data.users).toBeUndefined()
    expect(json).not.toContain('passwordHash')
    expect(json).not.toContain('staff-hash')
    expect(data.products).toHaveLength(1)
  })

  it('parser strip credential khỏi file legacy trước restore', () => {
    const legacy = backup({
      version: 5,
      credentialPolicy: undefined,
      users: [user({ passwordHash: 'legacy-secret', salt: 'legacy-salt' })],
    })
    const parsed = parseRestoreFile(JSON.stringify(legacy))

    expect(parsed.credentialPolicy).toBe('excluded')
    expect(parsed.version).toBeGreaterThanOrEqual(6)
    expect(parsed.users).toBeUndefined()
    expect(JSON.stringify(parsed)).not.toContain('legacy-secret')
  })

  it('đọc auto-backup cũ đồng thời scrub credential đã lưu trong meta', async () => {
    const legacy = backup({ version: 5, credentialPolicy: undefined, users: [user()] })
    await dbx.meta.put({ key: 'backups', value: [{ date: '2026-08-19T00:00:00.000Z', data: legacy }] })

    const backups = await getAutoBackups()
    const persisted = await getMeta<Array<{ data: BackupData }>>('backups', [])

    expect(backups[0]?.data.credentialPolicy).toBe('excluded')
    expect(backups[0]?.data.users).toBeUndefined()
    expect(persisted[0]?.data.users).toBeUndefined()
    expect(JSON.stringify(persisted)).not.toContain('passwordHash')
  })
})

describe('cloud snapshot credential policy', () => {
  it('giữ verifier staff nhưng redaction owner/admin', async () => {
    await dbx.users.bulkPut([
      user(),
      user({ id: 'u-admin', username: 'admin', role: 'admin', passwordHash: 'admin-hash', salt: 'admin-salt' }),
      user({ id: 'u-staff', username: 'staff', role: 'staff', passwordHash: 'staff-hash', salt: 'staff-salt', perms: { sell: true } }),
    ])

    const { snapshot } = await exportSnapshot()
    const users = snapshot.backup.users ?? []

    expect(snapshot.backup.credentialPolicy).toBe('staff-only')
    expect(users.find((row) => row.id === 'u-owner')).toMatchObject({ passwordHash: '', salt: '', passwordNeedsReset: true })
    expect(users.find((row) => row.id === 'u-admin')).toMatchObject({ passwordHash: '', salt: '', passwordNeedsReset: true })
    expect(users.find((row) => row.id === 'u-staff')).toMatchObject({ passwordHash: 'staff-hash', salt: 'staff-salt' })
  })

  it('snapshot redacted cùng user ID giữ verifier privileged riêng của máy', async () => {
    await dbx.users.put(user({ passwordHash: 'local-owner-hash', salt: 'local-owner-salt' }))
    await restoreBackup(backup({
      credentialPolicy: 'staff-only',
      users: [user({ name: 'Tên từ cloud', passwordHash: '', salt: '', passwordNeedsReset: true, updatedAt: 2 })],
    }), { userMode: 'snapshot' })

    expect(await dbx.users.get('u-owner')).toMatchObject({
      name: 'Tên từ cloud',
      passwordHash: 'local-owner-hash',
      salt: 'local-owner-salt',
      passwordNeedsReset: false,
    })
  })

  it('snapshot vẫn chứa hash owner thì không ghi lên máy', async () => {
    await dbx.users.put(user({ passwordHash: 'local-owner-hash', salt: 'local-owner-salt' }))
    await restoreBackup(backup({
      credentialPolicy: 'staff-only',
      users: [user({ name: 'Tên độc', passwordHash: 'cloud-stolen-hash', salt: 'cloud-stolen-salt', updatedAt: 9 })],
    }), { userMode: 'snapshot' })

    expect(await dbx.users.get('u-owner')).toMatchObject({
      name: 'Tên độc',
      passwordHash: 'local-owner-hash',
      salt: 'local-owner-salt',
    })
  })

  it('máy mới không nhận verifier privileged từ snapshot', async () => {
    await restoreBackup(backup({
      credentialPolicy: 'staff-only',
      users: [user({ passwordHash: '', salt: '', passwordNeedsReset: true })],
    }), { userMode: 'snapshot' })

    expect(await dbx.users.get('u-owner')).toMatchObject({
      passwordHash: '', salt: '', passwordNeedsReset: true,
    })
  })

  it('máy trống không nhận hash owner dù snapshot còn hash', async () => {
    await restoreBackup(backup({
      credentialPolicy: 'staff-only',
      users: [user({ passwordHash: 'cloud-hash', salt: 'cloud-salt' })],
    }), { userMode: 'snapshot' })

    expect(await dbx.users.get('u-owner')).toMatchObject({
      passwordHash: '', salt: '', passwordNeedsReset: true,
    })
  })
})

describe('local restore isolation', () => {
  it('giữ tài khoản local, bỏ user trong file và reset session/sync tenant', async () => {
    const owner = user({ passwordHash: 'local-hash', salt: 'local-salt' })
    await dbx.users.put(owner)
    await dbx.meta.bulkPut([
      { key: 'currentUser', value: owner },
      { key: 'cloud:shopId', value: 'shop-old' },
      { key: 'cloud:role', value: 'owner' },
      { key: 'sync:lastSeq', value: 99 },
    ])
    const pending = makeOp('stock.adjust', { productId: 'p-old', delta: 1, reason: 'pending' })
    await dbx.syncQueue.put(pending)
    await dbx.appliedOps.put({ id: pending.id })

    await restoreLocalBackup(backup({
      sourceShopId: 'shop-backup',
      products: [product()],
      users: [user({ id: 'attacker', username: 'attacker', passwordHash: 'file-secret', salt: 'file-salt' })],
      credentialPolicy: 'legacy',
    }))

    expect(await dbx.users.toArray()).toEqual([owner])
    expect(await dbx.users.get('attacker')).toBeUndefined()
    expect(await dbx.products.get('p1')).toBeTruthy()
    expect(await dbx.syncQueue.count()).toBe(0)
    expect(await dbx.appliedOps.count()).toBe(0)
    expect(await getMeta('currentUser', null)).toBeNull()
    expect(await getMeta('cloud:shopId', null)).toBeNull()
    expect(await getMeta('sync:lastSeq', 0)).toBe(0)
    expect(await getMeta('cloud:paused', false)).toBe(true)
    expect(JSON.stringify(await getMeta('restore:last', {}))).not.toContain('file-secret')
  })
})
