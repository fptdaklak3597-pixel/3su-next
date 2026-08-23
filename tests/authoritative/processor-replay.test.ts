import { describe, expect, it } from 'vitest'
import {
  applyCanonicalEvent,
  emptyShopState,
  type CanonicalEvent,
  type ProcessorGoodsReceipt,
  type ProcessorSale,
} from '@/core/authoritative/processor'

function ev(
  partial: Partial<CanonicalEvent> & Pick<CanonicalEvent, 'type' | 'payload'>,
): CanonicalEvent {
  return {
    id: partial.id ?? `ev_${partial.type}`,
    shopId: 'shop_1',
    seq: partial.seq ?? 1,
    commandId: partial.commandId ?? 'cmd_1',
    type: partial.type,
    occurredAt: '2026-08-20T10:00:00.000Z',
    committedAt: '2026-08-20T10:00:01.000Z',
    schemaVersion: 1,
    payload: partial.payload,
  }
}

describe('applyCanonicalEvent replay', () => {
  it('SaleVoided hoàn kho, giảm balance nợ và chỉ áp dụng một lần', () => {
    const state = emptyShopState('shop_1')
    state.products.p1 = {
      id: 'p1',
      name: 'SP',
      price: 10,
      cost: 4,
      stock: 0,
      unit: 'cái',
      units: [],
    }
    state.customers.c1 = { id: 'c1', name: 'K', balance: 5000 }
    const sale: ProcessorSale = {
      id: 's1',
      commandId: 'cmd_s',
      items: [
        {
          productId: 'p1',
          name: 'SP',
          qty: 1,
          unitName: 'cái',
          unitRatio: 1,
          price: 5000,
          cost: 4,
        },
      ],
      total: 5000,
      profit: 0,
      discount: 0,
      payMethod: 'debt',
      debtAmount: 5000,
      customerId: 'c1',
      occurredAt: '2026-08-20T10:00:00.000Z',
    }
    state.sales.s1 = sale
    const voided = ev({
      type: 'SaleVoided',
      seq: 2,
      commandId: 'cmd_v',
      payload: { saleId: 's1' },
    })

    const next = applyCanonicalEvent(state, voided)
    const duplicate = applyCanonicalEvent(next, voided)

    expect(next.sales.s1.voided).toBe(true)
    expect(next.products.p1.stock).toBe(1)
    expect(next.customers.c1.balance).toBe(0)
    expect(next.inventoryLedger).toContainEqual({
      id: 'inv_void_cmd_v_p1_0',
      productId: 'p1',
      delta: 1,
      reason: 'sale.void',
      commandId: 'cmd_v',
      saleId: 's1',
      at: '2026-08-20T10:00:01.000Z',
    })
    expect(next.customerLedger).toContainEqual({
      id: 'cust_void_cmd_v',
      party: 'customer',
      partyId: 'c1',
      delta: -5000,
      reason: 'SALE_VOID',
      commandId: 'cmd_v',
      at: '2026-08-20T10:00:01.000Z',
    })
    expect(duplicate).toBe(next)
  })

  it('SaleVoided multi-unit sale → distinct inv_void ids', () => {
    const state = emptyShopState('shop_1')
    state.products.p1 = {
      id: 'p1',
      name: 'SP',
      price: 10,
      cost: 4,
      stock: 74,
      unit: 'chai',
      units: [{ n: 'thùng', r: 24 }],
    }
    state.sales.s1 = {
      id: 's1',
      commandId: 'cmd_s',
      items: [
        {
          productId: 'p1',
          name: 'SP',
          qty: 2,
          unitName: 'chai',
          unitRatio: 1,
          price: 10,
          cost: 4,
        },
        {
          productId: 'p1',
          name: 'SP',
          qty: 1,
          unitName: 'thùng',
          unitRatio: 24,
          price: 240,
          cost: 96,
        },
      ],
      total: 260,
      profit: 0,
      discount: 0,
      payMethod: 'cash',
      debtAmount: 0,
      occurredAt: '2026-08-20T10:00:00.000Z',
    }
    const next = applyCanonicalEvent(
      state,
      ev({
        type: 'SaleVoided',
        seq: 2,
        commandId: 'cmd_v',
        payload: { saleId: 's1' },
      }),
    )
    const ids = next.inventoryLedger
      .filter((e) => e.commandId === 'cmd_v' && e.reason === 'sale.void')
      .map((e) => e.id)
    expect(ids).toEqual(['inv_void_cmd_v_p1_0', 'inv_void_cmd_v_p1_1'])
    expect(next.products.p1.stock).toBe(100)
  })

  it('GoodsReceiptCommitted cập nhật stock, giá vốn, NCC và chỉ lưu receipt một lần', () => {
    const state = emptyShopState('shop_1')
    state.products.p1 = {
      id: 'p1',
      name: 'SP',
      price: 10,
      cost: 500,
      stock: 5,
      unit: 'cái',
      units: [],
    }
    state.suppliers.s1 = { id: 's1', name: 'NCC', balance: 1000 }
    const gr: ProcessorGoodsReceipt = {
      id: 'gr1',
      commandId: 'cmd_g',
      rows: [
        {
          productId: 'p1',
          name: 'SP',
          qty: 5,
          unitName: 'cái',
          unitRatio: 1,
          purchasePrice: 1000,
        },
      ],
      supplierId: 's1',
      paid: 2000,
      payMethod: 'debt',
      occurredAt: '2026-08-20T10:00:00.000Z',
    }
    const committed = ev({
      id: 'ev_gr_1',
      type: 'GoodsReceiptCommitted',
      seq: 1,
      commandId: 'cmd_g',
      payload: gr,
    })

    const next = applyCanonicalEvent(state, committed)
    const duplicateReceipt = applyCanonicalEvent(
      next,
      ev({
        id: 'ev_gr_2',
        type: 'GoodsReceiptCommitted',
        seq: 2,
        commandId: 'cmd_g',
        payload: gr,
      }),
    )

    expect(next.receipts.gr1).toEqual(gr)
    expect(next.products.p1.stock).toBe(10)
    expect(next.products.p1.cost).toBe(750)
    expect(next.suppliers.s1.balance).toBe(4000)
    expect(next.inventoryLedger).toContainEqual({
      id: 'inv_gr_cmd_g_p1',
      productId: 'p1',
      delta: 5,
      reason: 'goodsReceipt',
      commandId: 'cmd_g',
      at: '2026-08-20T10:00:01.000Z',
    })
    expect(next.supplierLedger).toContainEqual({
      id: 'sup_cmd_g',
      party: 'supplier',
      partyId: 's1',
      delta: 3000,
      reason: 'GOODS_RECEIPT',
      commandId: 'cmd_g',
      at: '2026-08-20T10:00:01.000Z',
    })
    expect(duplicateReceipt.products.p1.stock).toBe(10)
    expect(duplicateReceipt.suppliers.s1.balance).toBe(4000)
    expect(duplicateReceipt.inventoryLedger).toHaveLength(1)
    expect(duplicateReceipt.supplierLedger).toHaveLength(1)
  })

  it('CustomerPaymentRecorded giảm balance và duplicate event là no-op', () => {
    const state = emptyShopState('shop_1')
    state.customers.c1 = { id: 'c1', name: 'K', balance: 9000 }
    const payment = ev({
      type: 'CustomerPaymentRecorded',
      seq: 1,
      commandId: 'cmd_p',
      payload: { customerId: 'c1', amount: 3000 },
    })

    const next = applyCanonicalEvent(state, payment)
    const duplicate = applyCanonicalEvent(next, payment)

    expect(next.customers.c1.balance).toBe(6000)
    expect(next.customerLedger).toContainEqual({
      id: 'pay_cmd_p',
      party: 'customer',
      partyId: 'c1',
      delta: -3000,
      reason: 'PAYMENT',
      commandId: 'cmd_p',
      at: '2026-08-20T10:00:01.000Z',
    })
    expect(duplicate).toBe(next)
  })

  it('SupplierPaymentRecorded giảm balance NCC', () => {
    const state = emptyShopState('shop_1')
    state.suppliers.s1 = { id: 's1', name: 'NCC', balance: 9000 }
    const next = applyCanonicalEvent(
      state,
      ev({
        type: 'SupplierPaymentRecorded',
        seq: 1,
        commandId: 'cmd_sp',
        payload: { supplierId: 's1', amount: 3000 },
      }),
    )

    expect(next.suppliers.s1.balance).toBe(6000)
    expect(next.supplierLedger).toContainEqual({
      id: 'spay_cmd_sp',
      party: 'supplier',
      partyId: 's1',
      delta: -3000,
      reason: 'PAYMENT',
      commandId: 'cmd_sp',
      at: '2026-08-20T10:00:01.000Z',
    })
  })

  it('SupplierPaymentRecorded trùng event id → no-op', () => {
    const state = emptyShopState('shop_1')
    state.suppliers.s1 = { id: 's1', name: 'NCC', balance: 9000 }
    const payment = ev({
      type: 'SupplierPaymentRecorded',
      seq: 1,
      commandId: 'cmd_sp',
      payload: { supplierId: 's1', amount: 3000 },
    })

    const next = applyCanonicalEvent(state, payment)
    const duplicate = applyCanonicalEvent(next, payment)

    expect(next.suppliers.s1.balance).toBe(6000)
    expect(duplicate).toBe(next)
  })
})
