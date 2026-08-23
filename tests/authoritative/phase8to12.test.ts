/**
 * Phase 8–12 gates: void, GR cost 225, payments, genesis, chaos, legacy guard
 */
import { describe, it, expect } from 'vitest'
import {
  emptyShopState,
  processCommand,
  type ShopState,
} from '@/core/authoritative/processor'
import {
  applyGenesis,
  fingerprintSnapshot,
  assertNoLegacyMoneyOp,
  type GenesisSnapshot,
} from '@/core/authoritative/genesis'

function seedBase(): ShopState {
  const s = emptyShopState('shop_1')
  s.products.p1 = {
    id: 'p1', name: 'SP', price: 10000, cost: 100, stock: 10, unit: 'chai', units: [{ n: 'thùng', r: 24 }],
  }
  s.customers.c1 = { id: 'c1', name: 'KH', balance: 100 }
  s.suppliers.s1 = { id: 's1', name: 'NCC', balance: 100 }
  return s
}

function sale(id: string, qty: number, stockState: ShopState) {
  return processCommand(stockState, {
    id, shopId: 'shop_1', deviceId: 'd', userId: 'u', type: 'sale.create',
    payload: { items: [{ productId: 'p1', qty, unitName: 'chai' }], payMethod: 'cash' },
    occurredAt: '2026-08-20T10:00:00.000Z', localSeq: 1, createdAt: 1,
  })
}

describe('Phase 8 — void', () => {
  it('void 2 lần / retry chỉ restore stock 1 lần', async () => {
    let state = seedBase()
    const s = await sale('sale1', 3, state)
    state = s.state
    expect(state.products.p1.stock).toBe(7)
    const saleId = Object.keys(state.sales)[0]
    const v1 = await processCommand(state, {
      id: 'void1', shopId: 'shop_1', deviceId: 'd', userId: 'u', type: 'sale.void',
      payload: { saleId }, occurredAt: '2026-08-20T11:00:00.000Z', localSeq: 2, createdAt: 2,
    })
    state = v1.state
    expect(v1.result.status).toBe('accepted')
    expect(state.products.p1.stock).toBe(10)
    const v2 = await processCommand(state, {
      id: 'void2', shopId: 'shop_1', deviceId: 'd', userId: 'u', type: 'sale.void',
      payload: { saleId }, occurredAt: '2026-08-20T11:00:00.000Z', localSeq: 3, createdAt: 3,
    })
    expect(v2.state.products.p1.stock).toBe(10)
  })
})

describe('Phase 9 — goods receipt weighted cost', () => {
  it('10@100 +10@200 +20@300 → cost 225', async () => {
    let state = emptyShopState('shop_1')
    state.products.p1 = {
      id: 'p1', name: 'SP', price: 500, cost: 100, stock: 10, unit: 'chai', units: [],
    }
    const mk = (id: string, qty: number, purchasePrice: number) =>
      processCommand(state, {
        id, shopId: 'shop_1', deviceId: 'd', userId: 'u', type: 'goodsReceipt.create',
        payload: {
          rows: [{ productId: 'p1', qty, unitName: 'chai', purchasePrice }],
          paid: qty * purchasePrice,
          payMethod: 'cash',
        },
        occurredAt: '2026-08-20T10:00:00.000Z', localSeq: 1, createdAt: 1,
      })
    state = (await mk('gr_a', 10, 200)).state
    state = (await mk('gr_b', 20, 300)).state
    // opening 10@100 + 10@200 + 20@300 = 1000+2000+6000=9000 / 40 = 225
    expect(state.products.p1.stock).toBe(40)
    expect(Math.round(state.products.p1.cost)).toBe(225)
  })

  it('unit giả / debt không NCC → reject', async () => {
    let state = seedBase()
    const badUnit = await processCommand(state, {
      id: 'gr_bad', shopId: 'shop_1', deviceId: 'd', userId: 'u', type: 'goodsReceipt.create',
      payload: {
        rows: [{ productId: 'p1', qty: 1, unitName: 'không_tồn_tại', purchasePrice: 10 }],
        payMethod: 'cash', paid: 10,
      },
      occurredAt: '2026-08-20T10:00:00.000Z', localSeq: 1, createdAt: 1,
    })
    expect(badUnit.result.status).toBe('rejected')
    const orphan = await processCommand(state, {
      id: 'gr_debt', shopId: 'shop_1', deviceId: 'd', userId: 'u', type: 'goodsReceipt.create',
      payload: {
        rows: [{ productId: 'p1', qty: 1, unitName: 'chai', purchasePrice: 10 }],
        payMethod: 'debt', paid: 0,
      },
      occurredAt: '2026-08-20T10:00:00.000Z', localSeq: 1, createdAt: 1,
    })
    expect(orphan.result.status).toBe('rejected')
  })
})

describe('Phase 10 — payments', () => {
  it('hai thu 80 trên nợ 100 → không thu 160', async () => {
    let state = seedBase()
    state.customers.c1.balance = 100
    const a = await processCommand(state, {
      id: 'pay_a', shopId: 'shop_1', deviceId: 'd', userId: 'u', type: 'customerPayment.create',
      payload: { customerId: 'c1', amount: 80 },
      occurredAt: '2026-08-20T10:00:00.000Z', localSeq: 1, createdAt: 1,
    })
    state = a.state
    expect(a.result.status).toBe('accepted')
    expect(state.customers.c1.balance).toBe(20)
    const b = await processCommand(state, {
      id: 'pay_b', shopId: 'shop_1', deviceId: 'd', userId: 'u', type: 'customerPayment.create',
      payload: { customerId: 'c1', amount: 80 },
      occurredAt: '2026-08-20T10:00:00.000Z', localSeq: 2, createdAt: 2,
    })
    expect(b.result.status).toBe('rejected')
    expect(b.state.customers.c1.balance).toBe(20)
  })

  it('supplier tương tự + overpay reject', async () => {
    let state = seedBase()
    state.suppliers.s1.balance = 100
    const a = await processCommand(state, {
      id: 'sp_a', shopId: 'shop_1', deviceId: 'd', userId: 'u', type: 'supplierPayment.create',
      payload: { supplierId: 's1', amount: 80 },
      occurredAt: '2026-08-20T10:00:00.000Z', localSeq: 1, createdAt: 1,
    })
    state = a.state
    const b = await processCommand(state, {
      id: 'sp_b', shopId: 'shop_1', deviceId: 'd', userId: 'u', type: 'supplierPayment.create',
      payload: { supplierId: 's1', amount: 80 },
      occurredAt: '2026-08-20T10:00:00.000Z', localSeq: 2, createdAt: 2,
    })
    expect(b.result.status).toBe('rejected')
    expect(b.state.suppliers.s1.balance).toBe(20)
  })
})

describe('Phase 11 — genesis', () => {
  it('genesis idempotent; snapshot lệch → block', () => {
    const base = emptyShopState('shop_1')
    base.products.p1 = { id: 'p1', name: 'A', price: 1, cost: 1, stock: 5, unit: 'cái', units: [] }
    const snap: GenesisSnapshot = {
      shopId: 'shop_1',
      products: base.products,
      customers: {},
      suppliers: {},
      fingerprint: '',
    }
    snap.fingerprint = fingerprintSnapshot(snap)
    const s1 = applyGenesis(emptyShopState('shop_1'), snap)
    expect(s1.products.p1.stock).toBe(5)
    const s2 = applyGenesis(s1, snap, snap)
    expect(s2.products.p1.stock).toBe(5)
    const bad = { ...snap, fingerprint: 'other' }
    expect(() => applyGenesis(s1, bad, snap)).toThrow(/GENESIS_MISMATCH/)
  })
})

describe('Phase 12 — chaos + legacy guard', () => {
  it('N sales concurrent logical — 0 âm kho, 0 dup effect', async () => {
    let state = emptyShopState('shop_1')
    state.products.p1 = {
      id: 'p1', name: 'SP', price: 1000, cost: 100, stock: 100, unit: 'chai', units: [],
    }
    let accepted = 0
    for (let i = 0; i < 150; i++) {
      const out = await processCommand(state, {
        id: `sale_${i}`, shopId: 'shop_1', deviceId: 'd', userId: 'u', type: 'sale.create',
        payload: { items: [{ productId: 'p1', qty: 1, unitName: 'chai' }], payMethod: 'cash' },
        occurredAt: '2026-08-20T10:00:00.000Z', localSeq: i, createdAt: i,
      })
      state = out.state
      if (out.result.status === 'accepted') accepted++
    }
    expect(accepted).toBe(100)
    expect(state.products.p1.stock).toBe(0)
    expect(Object.keys(state.sales)).toHaveLength(100)
    // retry same ids — no dup
    for (let i = 0; i < 100; i++) {
      const out = await processCommand(state, {
        id: `sale_${i}`, shopId: 'shop_1', deviceId: 'd', userId: 'u', type: 'sale.create',
        payload: { items: [{ productId: 'p1', qty: 1, unitName: 'chai' }], payMethod: 'cash' },
        occurredAt: '2026-08-20T10:00:00.000Z', localSeq: i, createdAt: i,
      })
      state = out.state
    }
    expect(Object.keys(state.sales)).toHaveLength(100)
    expect(state.products.p1.stock).toBe(0)
  })

  it('legacy money op bị cấm khi flag on', () => {
    expect(() => assertNoLegacyMoneyOp('sale.commit', true)).toThrow(/cấm/)
    expect(() => assertNoLegacyMoneyOp('note.upsert', true)).not.toThrow()
    expect(() => assertNoLegacyMoneyOp('sale.commit', false)).not.toThrow()
  })
})
