/**
 * Phân khúc khách — port từ 15a-customers.js customerSegments().
 */
import { dbx } from '../db'
import { uid, localDay, daysAgo } from '../format'
import { makeOp, persistOp, enqueueOp, requestFlush } from '../sync/engine'
import type { Customer, Sale, DebtPayment } from '../types'

export interface CustomerSegments {
  totals: Record<string, number>
  counts: Record<string, number>
  last: Record<string, string>
  vipIds: Set<string>
  loyalIds: Set<string>
  sleepIds: Set<string>
  newIds: Set<string>
}

export function customerSegments(customers: Customer[], sales: Sale[]): CustomerSegments {
  const totals: Record<string, number> = {}
  const counts: Record<string, number> = {}
  const last: Record<string, string> = {}

  for (const s of sales) {
    if (s.voided || !s.customerId) continue
    totals[s.customerId] = (totals[s.customerId] || 0) + s.total
    counts[s.customerId] = (counts[s.customerId] || 0) + 1
    const d = localDay(s.date)
    if (!last[s.customerId] || last[s.customerId] < d) last[s.customerId] = d
  }

  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1])
  const vipCut = Math.max(0, Math.ceil(entries.length * 0.2))
  const vipIds = new Set(entries.slice(0, vipCut).map((e) => e[0]))
  const loyalIds = new Set<string>()
  const sleepIds = new Set<string>()
  const newIds = new Set<string>()
  const d30 = daysAgo(30)
  const d14 = daysAgo(14)

  for (const c of customers) {
    const n = counts[c.id] || 0
    const l = last[c.id] || null
    if (n >= 3 && !vipIds.has(c.id)) loyalIds.add(c.id)
    if (l && l < d30) sleepIds.add(c.id)
    if (n >= 1 && n <= 2 && l && l >= d14) newIds.add(c.id)
  }

  return { totals, counts, last, vipIds, loyalIds, sleepIds, newIds }
}

/* ─── CRUD khách hàng + thu nợ (có outbox) ─── */
export async function addCustomer(input: { name: string; phone: string; note: string; wholesale: boolean }): Promise<Customer> {
  const now = Date.now()
  const c: Customer = {
    id: uid('c'),
    name: input.name.trim(),
    phone: input.phone.trim(),
    note: input.note.trim(),
    debt: 0,
    totalSpent: 0,
    orderCount: 0,
    wholesale: input.wholesale,
    createdAt: now,
    updatedAt: now,
  }
  await dbx.transaction('rw', [dbx.customers, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('customer.upsert', null)
    c.hlc = op.hlc
    await dbx.customers.add(c)
    const { debt: _d, totalSpent: _ts, orderCount: _oc, ...rest } = c
    op.payload = { customer: rest }
    await persistOp(op)
  })
  requestFlush()
  return c
}

export async function updateCustomer(id: string, patch: Partial<Customer>): Promise<void> {
  const c = await dbx.customers.get(id)
  if (!c) return
  await dbx.transaction('rw', [dbx.customers, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('customer.upsert', null)
    const updated: Customer = { ...c, ...patch, id, updatedAt: Date.now(), hlc: op.hlc }
    const omit = new Set(['id', 'debt', 'totalSpent', 'orderCount', 'fieldHlc', 'hlc', 'deletedHlc'])
    const customer: Record<string, unknown> = { id }
    const fieldHlc = { ...(c.fieldHlc ?? {}) }
    for (const key of Object.keys(updated) as (keyof Customer)[]) {
      if (omit.has(key)) continue
      if (!Object.is(updated[key], c[key])) {
        customer[key] = updated[key]
        fieldHlc[key] = op.hlc
      }
    }
    updated.fieldHlc = fieldHlc
    await dbx.customers.put(updated)
    op.payload = { customer }
    await persistOp(op)
  })
  requestFlush()
}

export async function deleteCustomer(id: string): Promise<void> {
  const c = await dbx.customers.get(id)
  if (!c) return
  await dbx.transaction('rw', [dbx.customers, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('customer.delete', { customerId: id })
    await dbx.customers.put({ ...c, deleted: true, deletedHlc: op.hlc, hlc: op.hlc, updatedAt: Date.now() })
    await persistOp(op)
  })
  requestFlush()
}

/** Đơn giả để in biên lai thu nợ. */
export function debtReceiptSale(amount: number, customerId: string | null): import('../types').Sale {
  return {
    id: 'THU-' + Date.now(),
    items: [{ productId: '_debt', name: 'Thu nợ', qty: 1, price: amount, cost: 0, unit: 'lần', unitRatio: 1 }],
    total: amount,
    profit: 0,
    discount: 0,
    payMethod: 'cash',
    tendered: amount,
    change: 0,
    debtAmount: 0,
    customerId,
    date: new Date().toISOString(),
  }
}

/** Sửa nợ âm còn trong DB (S2 cũ). Không tạo op. */
export async function clampNegativeCustomerDebts(): Promise<number> {
  const all = await dbx.customers.toArray()
  let n = 0
  for (const c of all) {
    if (c.debt >= 0) continue
    c.debt = 0
    c.updatedAt = Date.now()
    await dbx.customers.put(c)
    n += 1
  }
  return n
}

export async function payDebt(customerId: string, amount: number, note?: string): Promise<void> {
  const c0 = await dbx.customers.get(customerId)
  if (!c0) throw new Error('Không tìm thấy khách hàng')
  const clamped = Math.min(Math.round(amount), Math.max(0, c0.debt))
  if (clamped <= 0) return
  const dp: DebtPayment = {
    id: uid('dp'),
    customerId,
    amount: clamped,
    date: new Date().toISOString(),
    note: note ?? 'Thu nợ',
  }
  await dbx.transaction('rw', [dbx.customers, dbx.debtPayments, dbx.syncQueue, dbx.appliedOps], async () => {
    const c = await dbx.customers.get(customerId)
    if (!c) throw new Error('Không tìm thấy khách hàng')
    const next = Math.min(clamped, Math.max(0, c.debt))
    if (next <= 0) return
    c.debt = Math.max(0, c.debt - next)
    c.updatedAt = Date.now()
    dp.amount = next
    await dbx.customers.put(c)
    await dbx.debtPayments.add(dp)
    await enqueueOp('debt.pay', dp)
  })
  requestFlush()
}
