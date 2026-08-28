import { beforeEach, describe, expect, it } from 'vitest'
import { dbx, DEFAULT_SETTINGS, restoreLocalBackup, type BackupData } from '@/core/db'
import { archiveThenClearSyncQueue, PRE_V5_QUEUE_META } from '@/core/db-core'
import {
  backupSchemaWarnings,
  canConfirmWipe,
  emptyRestoreAck,
  emptyRestoreConfirmToken,
  isEmptyBusinessBackup,
  restorePausedCopy,
} from '@/core/domain/trial'
import type { Product } from '@/core/types'

function product(): Product {
  return {
    id: 'p1', name: 'SP', cat: 'Khác', price: 10, cost: 5, stock: 1,
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
  await Promise.all([dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(), dbx.meta.clear()])
})

describe('restore rỗng + version + wipe gate', () => {
  it('file không có SP/đơn/khách là rỗng', () => {
    expect(isEmptyBusinessBackup({ products: [], sales: [], customers: [] })).toBe(true)
    expect(isEmptyBusinessBackup({ products: [product()], sales: [], customers: [] })).toBe(false)
  })

  it('version < 6 → cảnh nhưng không chặn', () => {
    expect(backupSchemaWarnings({ version: 5 })).toEqual([
      'File sao lưu bản cũ (version 5). Kiểm tra kỹ trước khi khôi phục.',
    ])
    expect(backupSchemaWarnings({ version: 6 })).toEqual([])
  })

  it('wipe chỉ khi đã xuất hoặc xác nhận có file ngoài máy', () => {
    expect(canConfirmWipe({ exportedThisSession: false, hasExternalBackup: false })).toBe(false)
    expect(canConfirmWipe({ exportedThisSession: true, hasExternalBackup: false })).toBe(true)
    expect(canConfirmWipe({ exportedThisSession: false, hasExternalBackup: true })).toBe(true)
  })

  it('file rỗng bắt gõ đúng tên shop', () => {
    expect(emptyRestoreConfirmToken('Tạp hóa A')).toBe('Tạp hóa A')
    expect(emptyRestoreAck('Tạp hóa A', 'Tạp hóa A')).toBe(true)
    expect(emptyRestoreAck('khác', 'Tạp hóa A')).toBe(false)
  })

  it('restoreLocalBackup từ chối file rỗng trừ allowEmpty', async () => {
    await expect(restoreLocalBackup(backup())).rejects.toThrow(/không có sản phẩm/)
    await restoreLocalBackup(backup(), { allowEmpty: true })
    expect(await dbx.products.count()).toBe(0)
  })

  it('restore có hàng thì chạy và ghi cloud:paused', async () => {
    await restoreLocalBackup(backup({ products: [product()] }))
    expect(await dbx.products.count()).toBe(1)
    expect((await dbx.meta.get('cloud:paused'))?.value).toBe(true)
    expect(restorePausedCopy(true, { at: 1 })).toMatch(/Thiết bị/)
    expect(restorePausedCopy(false, { at: 1 })).toBeNull()
  })
})

describe('archiveThenClearSyncQueue (v4→v5)', () => {
  it('chép hàng đợi vào meta rồi mới xóa', async () => {
    const ops = [{ id: 'op1', type: 'sale.create' }]
    let stored: { key: string; value: unknown } | null = null
    const queue = {
      toArray: async () => [...ops],
      clear: async () => { ops.length = 0 },
    }
    const meta = {
      put: async (row: { key: string; value: unknown }) => { stored = row },
    }
    const n = await archiveThenClearSyncQueue(queue, meta, 1_700_000_000_000)
    expect(n).toBe(1)
    expect(ops).toEqual([])
    expect(stored?.key).toBe(PRE_V5_QUEUE_META)
    expect((stored?.value as { count: number }).count).toBe(1)
  })
})
