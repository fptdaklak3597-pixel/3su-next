import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine, makeOp } from '@/core/sync/engine'
import { applyOps } from '@/core/sync/apply'
import { hlcString } from '@/core/sync/hlc'
import type { Product, Customer, Supplier, SyncOp } from '@/core/types'

let seq = 0
function mkProduct(over: Partial<Product> = {}): Product {
  seq += 1
  return {
    id: 'p' + seq, name: 'Sản phẩm ' + seq, cat: 'Khác', price: 5000, cost: 3000,
    stock: 100, unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: Date.now(), updatedAt: Date.now(), ...over,
  }
}

function mkCustomer(over: Partial<Customer> = {}): Customer {
  seq += 1
  return {
    id: 'c' + seq, name: 'Khách ' + seq, phone: '', note: '', debt: 0, totalSpent: 0,
    orderCount: 0, createdAt: Date.now(), updatedAt: Date.now(), ...over,
  }
}

function mkSupplier(over: Partial<Supplier> = {}): Supplier {
  seq += 1
  return {
    id: 'sp' + seq, name: 'NCC ' + seq, phone: '', address: '', note: '', leadDays: 0,
    debt: 0, totalPurchased: 0, orderCount: 0, createdAt: Date.now(), updatedAt: Date.now(),
    ...over,
  }
}

/** Giả op máy khác: giữ hlc của makeOp, đổi deviceId. */
function remoteOp(type: SyncOp['type'], payload: unknown, hlc?: string): SyncOp {
  const op = makeOp(type, payload)
  return { ...op, deviceId: 'dev_remote', ...(hlc ? { hlc, id: hlc } : {}) }
}

beforeEach(async () => {
  await Promise.all([dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
    dbx.debtPayments.clear(), dbx.goodsReceipts.clear(), dbx.stockMoves.clear(),
    dbx.stocktakes.clear(), dbx.notes.clear(), dbx.batches.clear(), dbx.priceLog.clear(),
    dbx.suppliers.clear(), dbx.supplierPayments.clear(), dbx.users.clear(),
    dbx.purchaseOrders.clear(), dbx.invoices.clear(), dbx.pricingRules.clear(),
    dbx.devices.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear()])
  await initSyncEngine()
})

describe('S4 — xóa thắng upsert cũ hơn', () => {
  it('product.delete HLC mới hơn rồi upsert HLC cũ → vẫn deleted', async () => {
    await dbx.products.add(mkProduct({ id: 'p1' }))
    await applyOps([remoteOp('product.delete', { productId: 'p1' }, hlcString(3000, 0, 'dev_a'))])
    await applyOps([remoteOp('product.upsert', { product: { id: 'p1', name: 'Sống lại' } }, hlcString(1000, 0, 'dev_b'))])
    const p = (await dbx.products.get('p1'))!
    expect(p.deleted).toBe(true)
    expect(p.name).not.toBe('Sống lại')
  })

  it('customer.delete HLC mới hơn rồi upsert HLC cũ → vẫn deleted', async () => {
    await dbx.customers.add(mkCustomer({ id: 'c1', name: 'An', phone: '1' }))
    await applyOps([remoteOp('customer.delete', { customerId: 'c1' }, hlcString(3000, 0, 'dev_a'))])
    await applyOps([remoteOp('customer.upsert', { customer: { id: 'c1', name: 'Sống lại' } }, hlcString(1000, 0, 'dev_b'))])
    const c = (await dbx.customers.get('c1'))!
    expect(c.deleted).toBe(true)
    expect(c.name).not.toBe('Sống lại')
  })
})

describe('M9 — customer fieldHlc', () => {
  it('máy A sửa tên, máy B sửa SĐT — cả hai giữ', async () => {
    await dbx.customers.add(mkCustomer({ id: 'c1', name: 'An', phone: '1' }))
    await applyOps([remoteOp('customer.upsert', { customer: { id: 'c1', name: 'An B' } }, hlcString(2000, 0, 'dev_a'))])
    await applyOps([remoteOp('customer.upsert', { customer: { id: 'c1', phone: '0909' } }, hlcString(3000, 0, 'dev_b'))])
    const c = (await dbx.customers.get('c1'))!
    expect(c.name).toBe('An B')
    expect(c.phone).toBe('0909')
  })

  it('máy A sửa tên NCC, máy B sửa SĐT — cả hai giữ', async () => {
    await dbx.suppliers.add(mkSupplier({ id: 'sp1', name: 'NCC A', phone: '1' }))
    await applyOps([remoteOp('supplier.upsert', { supplier: { id: 'sp1', name: 'NCC B' } }, hlcString(2000, 0, 'dev_a'))])
    await applyOps([remoteOp('supplier.upsert', { supplier: { id: 'sp1', phone: '0909' } }, hlcString(3000, 0, 'dev_b'))])
    const s = (await dbx.suppliers.get('sp1'))!
    expect(s.name).toBe('NCC B')
    expect(s.phone).toBe('0909')
  })
})

describe('L5 — note.delete tombstone', () => {
  it('delete rồi upsert cũ hơn → note vẫn deleted, không mất hàng', async () => {
    await applyOps([remoteOp('note.upsert', {
      id: 'n1', text: 'a', date: '2026-08-18', type: 'note', done: false, pinned: false,
    }, hlcString(1000, 0, 'dev_a'))])
    await applyOps([remoteOp('note.delete', { noteId: 'n1' }, hlcString(3000, 0, 'dev_a'))])
    await applyOps([remoteOp('note.upsert', {
      id: 'n1', text: 'cũ', date: '2026-08-18', type: 'note', done: false, pinned: false,
    }, hlcString(2000, 0, 'dev_b'))])
    const n = await dbx.notes.get('n1')
    expect(n).toBeTruthy()
    expect(n!.deleted).toBe(true)
  })

  it('invoice.delete rồi upsert cũ hơn → vẫn tombstone', async () => {
    await applyOps([remoteOp('invoice.upsert', {
      id: 'inv1', code: 'HD-1', type: 'import', date: '2026-08-18',
      amount: 10000, tax: 0, status: 'draft', data: {}, ts: 1,
    }, hlcString(1000, 0, 'dev_a'))])
    await applyOps([remoteOp('invoice.delete', { invoiceId: 'inv1' }, hlcString(3000, 0, 'dev_a'))])
    await applyOps([remoteOp('invoice.upsert', {
      id: 'inv1', code: 'cũ', type: 'import', date: '2026-08-18',
      amount: 1, tax: 0, status: 'issued', data: {}, ts: 1,
    }, hlcString(2000, 0, 'dev_b'))])
    const inv = await dbx.invoices.get('inv1')
    expect(inv).toBeTruthy()
    expect(inv!.deleted).toBe(true)
    expect(inv!.code).toBe('HD-1')
  })

  it('pricing.delete rồi upsert cũ hơn → vẫn tombstone', async () => {
    await applyOps([remoteOp('pricing.upsert', {
      id: 'pr1', name: 'Cafe 40%', cat: 'Cafe', marginPct: 40, roundTo: 1000, active: true,
    }, hlcString(1000, 0, 'dev_a'))])
    await applyOps([remoteOp('pricing.delete', { ruleId: 'pr1' }, hlcString(3000, 0, 'dev_a'))])
    await applyOps([remoteOp('pricing.upsert', {
      id: 'pr1', name: 'cũ', cat: 'Cafe', marginPct: 10, roundTo: 100, active: false,
    }, hlcString(2000, 0, 'dev_b'))])
    const r = await dbx.pricingRules.get('pr1')
    expect(r).toBeTruthy()
    expect(r!.deleted).toBe(true)
    expect(r!.name).toBe('Cafe 40%')
  })
})
