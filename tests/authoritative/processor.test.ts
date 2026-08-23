/**
 * Phase 2 gate — in-memory authoritative processor
 */
import { describe, it, expect } from 'vitest'
import {
  emptyShopState,
  processCommand,
  applyCanonicalEvent,
  type ShopState,
  type ProcessorProduct,
} from '@/core/authoritative/processor'

function baseProduct(over: Partial<ProcessorProduct> = {}): ProcessorProduct {
  return {
    id: 'p1',
    name: 'SP1',
    price: 10000,
    cost: 4000,
    stock: 1,
    unit: 'chai',
    units: [{ n: 'thùng', r: 24 }],
    ...over,
  }
}

function seed(stock = 1): ShopState {
  const s = emptyShopState('shop_1')
  s.products.p1 = baseProduct({ stock })
  s.customers.c1 = { id: 'c1', name: 'Khách', balance: 0 }
  return s
}

function saleCmd(id: string, qty = 1, over: Record<string, unknown> = {}) {
  return {
    id,
    shopId: 'shop_1',
    deviceId: 'dev_1',
    userId: 'user_1',
    type: 'sale.create',
    payload: {
      items: [{ productId: 'p1', qty, unitName: 'chai' }],
      payMethod: 'cash',
      ...over,
    },
    occurredAt: '2026-08-20T10:00:00.000Z',
    localSeq: 1,
    createdAt: 1,
  }
}

describe('authoritative processor — Phase 2 gate', () => {
  it('cùng commandId gửi 10 lần → 1 business effect', async () => {
    let state = seed(10)
    const cmd = saleCmd('cmd_same', 1)
    for (let i = 0; i < 10; i++) {
      const out = await processCommand(state, cmd)
      state = out.state
      expect(out.result.status).toBe('accepted')
      expect(out.result.commandId).toBe('cmd_same')
    }
    expect(state.products.p1.stock).toBe(9)
    expect(Object.keys(state.sales)).toHaveLength(1)
    expect(outBumpedOnce(state)).toBe(true)
  })

  it('seq không lùi; duplicate event apply → no-op', async () => {
    let state = seed(5)
    const out = await processCommand(state, saleCmd('cmd_a', 1))
    state = out.state
    const seq1 = state.seq
    expect(seq1).toBeGreaterThan(0)
    const ev = state.events[0]
    const again = applyCanonicalEvent(state, ev)
    expect(again.seq).toBe(seq1)
    expect(again.products.p1.stock).toBe(state.products.p1.stock)
    const out2 = await processCommand(state, saleCmd('cmd_b', 1))
    expect(out2.state.seq).toBeGreaterThanOrEqual(seq1)
  })

  it('stock=1, hai command bán 1 → 1 accepted + 1 conflict, stock=0', async () => {
    let state = seed(1)
    const a = await processCommand(state, saleCmd('cmd_a', 1))
    state = a.state
    expect(a.result.status).toBe('accepted')
    expect(a.bumped).toBe(true)
    const b = await processCommand(state, saleCmd('cmd_b', 1))
    state = b.state
    expect(b.result.status).toBe('conflict')
    expect(b.bumped).toBe(false)
    expect(state.products.p1.stock).toBe(0)
    expect(Object.keys(state.sales)).toHaveLength(1)
  })

  it('payload giả total/price bị contracts reject — không đổi stock', async () => {
    const state = seed(3)
    const bad = saleCmd('cmd_fake', 1)
    ;(bad.payload as Record<string, unknown>).total = 1
    const out = await processCommand(state, bad)
    expect(out.result.status).toBe('rejected')
    expect(out.state.products.p1.stock).toBe(3)
    expect(out.bumped).toBe(false)
  })

  it('commit fail → không lộ state ma, bumped=false, surface COMMIT_FAILED', async () => {
    const state = seed(2)
    const out = await processCommand(state, saleCmd('cmd_fail', 1), {
      commit: () => {
        throw new Error('sqlite fail')
      },
    })
    expect(out.result.status).toBe('rejected')
    expect(out.result.error?.code).toBe('COMMIT_FAILED')
    expect(out.bumped).toBe(false)
    expect(out.state.products.p1.stock).toBe(2)
    expect(out.state.commandResults.cmd_fail).toBeUndefined()
  })

  it('server tự tính total từ catalog, không tin client', async () => {
    let state = seed(5)
    state.products.p1.price = 10000
    state.products.p1.cost = 4000
    const out = await processCommand(state, saleCmd('cmd_price', 2))
    expect(out.result.status).toBe('accepted')
    const sale = Object.values(out.state.sales)[0]
    expect(sale.total).toBe(20000)
    expect(sale.items[0].price).toBe(10000)
    expect(sale.items[0].cost).toBe(4000)
  })

  it('wholesale: true dùng wholesalePrice khi > 0', async () => {
    let state = seed(5)
    state.products.p1.price = 10000
    state.products.p1.wholesalePrice = 8000
    const out = await processCommand(
      state,
      saleCmd('cmd_ws', 1, { wholesale: true }),
    )
    expect(out.result.status).toBe('accepted')
    const sale = Object.values(out.state.sales)[0]
    expect(sale.items[0].price).toBe(8000)
    expect(sale.total).toBe(8000)
  })

  it('wholesale: true nhưng wholesalePrice=0 → giá lẻ', async () => {
    let state = seed(5)
    state.products.p1.price = 10000
    state.products.p1.wholesalePrice = 0
    const out = await processCommand(
      state,
      saleCmd('cmd_ws0', 1, { wholesale: true }),
    )
    expect(out.result.status).toBe('accepted')
    expect(Object.values(out.state.sales)[0].items[0].price).toBe(10000)
  })

  it('hai dòng cùng SP khác đơn vị → ledger id khác nhau', async () => {
    let state = seed(100)
    state.products.p1.units = [{ n: 'thùng', r: 24 }]
    const out = await processCommand(state, {
      id: 'cmd_multi',
      shopId: 'shop_1',
      deviceId: 'dev_1',
      userId: 'user_1',
      type: 'sale.create',
      payload: {
        items: [
          { productId: 'p1', qty: 2, unitName: 'chai' },
          { productId: 'p1', qty: 1, unitName: 'thùng' },
        ],
        payMethod: 'cash',
      },
      occurredAt: '2026-08-20T10:00:00.000Z',
      localSeq: 1,
      createdAt: 1,
    })
    expect(out.result.status).toBe('accepted')
    const ids = out.state.inventoryLedger
      .filter((e) => e.commandId === 'cmd_multi' && e.reason === 'sale')
      .map((e) => e.id)
    expect(ids).toEqual(['inv_cmd_multi_p1_0', 'inv_cmd_multi_p1_1'])
    expect(new Set(ids).size).toBe(2)
  })

  it('multi-unit sale void → distinct inv_void ids', async () => {
    let state = seed(100)
    state.products.p1.units = [{ n: 'thùng', r: 24 }]
    const saleOut = await processCommand(state, {
      id: 'cmd_multi',
      shopId: 'shop_1',
      deviceId: 'dev_1',
      userId: 'user_1',
      type: 'sale.create',
      payload: {
        items: [
          { productId: 'p1', qty: 2, unitName: 'chai' },
          { productId: 'p1', qty: 1, unitName: 'thùng' },
        ],
        payMethod: 'cash',
      },
      occurredAt: '2026-08-20T10:00:00.000Z',
      localSeq: 1,
      createdAt: 1,
    })
    expect(saleOut.result.status).toBe('accepted')
    const saleId = Object.keys(saleOut.state.sales)[0]
    const voidOut = await processCommand(saleOut.state, {
      id: 'cmd_void',
      shopId: 'shop_1',
      deviceId: 'dev_1',
      userId: 'user_1',
      type: 'sale.void',
      payload: { saleId },
      occurredAt: '2026-08-20T10:01:00.000Z',
      localSeq: 2,
      createdAt: 2,
    })
    expect(voidOut.result.status).toBe('accepted')
    const ids = voidOut.state.inventoryLedger
      .filter((e) => e.commandId === 'cmd_void' && e.reason === 'sale.void')
      .map((e) => e.id)
    expect(ids).toEqual(['inv_void_cmd_void_p1_0', 'inv_void_cmd_void_p1_1'])
    expect(new Set(ids).size).toBe(2)
  })

  it('GR cập nhật cost bình quân gia quyền một lần', async () => {
    let state = seed(0)
    state.products.p1.stock = 10
    state.products.p1.cost = 1000
    const grCmd = {
      id: 'gr_wac',
      shopId: 'shop_1',
      deviceId: 'dev_1',
      userId: 'user_1',
      type: 'goodsReceipt.create' as const,
      payload: {
        rows: [{ productId: 'p1', qty: 10, unitName: 'chai', purchasePrice: 2000 }],
        paid: 20000,
        payMethod: 'cash',
      },
      occurredAt: '2026-08-20T10:00:00.000Z',
      localSeq: 1,
      createdAt: 1,
    }
    const out = await processCommand(state, grCmd)
    expect(out.result.status).toBe('accepted')
    expect(out.state.products.p1.cost).toBe(1500)
    expect(out.state.products.p1.stock).toBe(20)
  })

  it('GR paid > total → reject PAID_EXCEEDS_TOTAL', async () => {
    const state = seed(0)
    const out = await processCommand(state, {
      id: 'gr_over',
      shopId: 'shop_1',
      deviceId: 'dev_1',
      userId: 'user_1',
      type: 'goodsReceipt.create',
      payload: {
        rows: [{ productId: 'p1', qty: 1, unitName: 'chai', purchasePrice: 1000 }],
        paid: 1500,
        payMethod: 'cash',
      },
      occurredAt: '2026-08-20T10:00:00.000Z',
      localSeq: 1,
      createdAt: 1,
    })
    expect(out.result.status).toBe('rejected')
    expect(out.result.error?.code).toBe('PAID_EXCEEDS_TOTAL')
  })

  it('GR còn nợ mà thiếu NCC → reject SUPPLIER_REQUIRED', async () => {
    const state = seed(0)
    const out = await processCommand(state, {
      id: 'gr_owed',
      shopId: 'shop_1',
      deviceId: 'dev_1',
      userId: 'user_1',
      type: 'goodsReceipt.create',
      payload: {
        rows: [{ productId: 'p1', qty: 1, unitName: 'chai', purchasePrice: 1000 }],
        paid: 200,
        payMethod: 'cash',
      },
      occurredAt: '2026-08-20T10:00:00.000Z',
      localSeq: 1,
      createdAt: 1,
    })
    expect(out.result.status).toBe('rejected')
    expect(out.result.error?.code).toBe('SUPPLIER_REQUIRED')
  })

  it('GR làm tròn giá vốn bình quân về VND nguyên', async () => {
    let state = seed(0)
    state.products.p1.stock = 3
    state.products.p1.cost = 1000
    const grCmd = {
      id: 'gr_round',
      shopId: 'shop_1',
      deviceId: 'dev_1',
      userId: 'user_1',
      type: 'goodsReceipt.create' as const,
      payload: {
        rows: [{ productId: 'p1', qty: 1, unitName: 'chai', purchasePrice: 1001 }],
        paid: 1001,
        payMethod: 'cash',
      },
      occurredAt: '2026-08-20T10:00:00.000Z',
      localSeq: 1,
      createdAt: 1,
    }
    const out = await processCommand(state, grCmd)
    expect(out.result.status).toBe('accepted')
    // (3*1000 + 1*1001) / 4 = 1000.25 → làm tròn 1000
    expect(out.state.products.p1.cost).toBe(1000)
    expect(Number.isInteger(out.state.products.p1.cost)).toBe(true)
  })

  it('tiền mặt trả thiếu → ghi nợ phần còn lại cho khách', async () => {
    const state = seed(10)
    const out = await processCommand(
      state,
      saleCmd('cmd_cash_debt', 1, { tendered: 6000, customerId: 'c1' }),
    )
    expect(out.result.status).toBe('accepted')
    const sale = Object.values(out.state.sales)[0]
    expect(sale.total).toBe(10000)
    expect(sale.debtAmount).toBe(4000)
    expect(out.state.customers.c1.balance).toBe(4000)
    expect(out.result.events.some((e) => e.type === 'CustomerCharged')).toBe(true)
  })

  it('tiền mặt trả đủ (tendered ≥ total) → không ghi nợ', async () => {
    const state = seed(10)
    const out = await processCommand(
      state,
      saleCmd('cmd_cash_full', 1, { tendered: 10000, customerId: 'c1' }),
    )
    expect(out.result.status).toBe('accepted')
    expect(Object.values(out.state.sales)[0].debtAmount).toBe(0)
    expect(out.state.customers.c1.balance).toBe(0)
  })

  it('tiền mặt trả thiếu nhưng không chọn khách → reject', async () => {
    const state = seed(10)
    const out = await processCommand(
      state,
      saleCmd('cmd_cash_debt_nocust', 1, { tendered: 6000 }),
    )
    expect(out.result.status).toBe('rejected')
    expect(out.result.error?.code).toBe('CUSTOMER_REQUIRED')
    expect(out.state.products.p1.stock).toBe(10)
  })
})

function outBumpedOnce(state: ShopState): boolean {
  return Object.keys(state.sales).length === 1
}
