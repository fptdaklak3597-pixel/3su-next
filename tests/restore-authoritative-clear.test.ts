import { beforeEach, describe, expect, it } from 'vitest'
import { dbx, DEFAULT_SETTINGS, restoreLocalBackup, type BackupData } from '@/core/db'
import type { QueuedCommand, SyncConflictRow } from '@/core/authoritative/commandQueue'
import type { CanonicalEvent, CommandEnvelope, CommandResult } from '@/core/authoritative/contracts'
import type { Product } from '@/core/types'

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

function envelope(id: string): CommandEnvelope {
  return {
    id,
    shopId: 'shop_1',
    deviceId: 'dev_1',
    userId: 'u1',
    type: 'sale.create',
    payload: { items: [{ productId: 'p1', qty: 1, unitName: 'chai' }], payMethod: 'cash' },
    occurredAt: '2026-08-20T10:00:00.000Z',
    localSeq: 1,
    createdAt: 1,
  }
}

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(),
    dbx.commandQueue.clear(),
    dbx.commandResults.clear(),
    dbx.canonicalEvents.clear(),
    dbx.syncConflicts.clear(),
    dbx.syncQueue.clear(),
    dbx.appliedOps.clear(),
    dbx.meta.clear(),
  ])
})

describe('restoreLocalBackup authoritative clear', () => {
  it('restoreLocalBackup xóa commandQueue / results / events / syncConflicts', async () => {
    const queued: QueuedCommand = {
      id: 'q1',
      type: 'sale.create',
      createdAt: 1,
      status: 'pending',
      envelope: envelope('q1'),
    }
    const result: CommandResult & { storedAt?: number } = {
      commandId: 'q1',
      status: 'accepted',
      events: [],
      storedAt: 1,
    }
    const event: CanonicalEvent = {
      id: 'e1',
      shopId: 'shop_1',
      seq: 1,
      commandId: 'q1',
      type: 'SaleCommitted',
      occurredAt: '2026-08-20T10:00:00.000Z',
      committedAt: '2026-08-20T10:00:01.000Z',
      schemaVersion: 1,
      payload: {},
    }
    const conflict: SyncConflictRow = {
      id: 'c1',
      commandId: 'q1',
      createdAt: 1,
      reason: 'conflict',
    }

    await dbx.commandQueue.put(queued)
    await dbx.commandResults.put(result)
    await dbx.canonicalEvents.put(event)
    await dbx.syncConflicts.put(conflict)

    await restoreLocalBackup(backup({ products: [product()] }))

    expect(await dbx.commandQueue.count()).toBe(0)
    expect(await dbx.commandResults.count()).toBe(0)
    expect(await dbx.canonicalEvents.count()).toBe(0)
    expect(await dbx.syncConflicts.count()).toBe(0)
  })
})
