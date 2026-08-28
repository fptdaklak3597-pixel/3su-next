import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import {
  DRAFT_CART,
  DRAFT_PO,
  DRAFT_PRODUCT,
  DRAFT_TTL_MS,
  clearDraft,
  isDraftFresh,
  loadFreshDraft,
  persistCartDraft,
  persistPoDraft,
  persistProductDraft,
  type CartDraft,
  type PoDraft,
  type ProductDraft,
} from '@/core/domain/drafts'
import { hydrateCartDraft } from '@/shared/useCartDraftPersistence'
import { cartUnitPrice, saleUsesWholesale } from '@/core/domain/sales'
import type { CartItem } from '@/core/domain/sales'

function line(): CartItem {
  return { productId: 'p1', qty: 2, unitName: 'cái', unitRatio: 1 }
}

beforeEach(async () => {
  await dbx.meta.clear()
  useApp.setState({
    cart: [],
    customerId: null,
    discount: 0,
    discountKind: 'amount',
    payMethod: 'cash',
    tendered: 0,
    cashEntered: false,
    wholesaleMode: false,
  })
})

describe('draft giỏ TTL 24h', () => {
  it('còn hạn thì hydrate được', async () => {
    await persistCartDraft({
      items: [line()],
      customerId: 'c1',
      discount: 1000,
      discountKind: 'amount',
      payMethod: 'cash',
      tendered: 50000,
      cashEntered: true,
      wholesale: true,
    })
    const d = await loadFreshDraft<CartDraft>(DRAFT_CART)
    expect(d?.items).toEqual([line()])
    expect(d?.customerId).toBe('c1')
    expect(d?.wholesale).toBe(true)
    expect(d?.tendered).toBe(50000)
    expect(d?.cashEntered).toBe(true)
    expect(await hydrateCartDraft()).toBe(true)
    expect(useApp.getState().tendered).toBe(50000)
    expect(useApp.getState().cashEntered).toBe(true)
  })

  it('hết hạn thì bỏ', async () => {
    await dbx.meta.put({
      key: DRAFT_CART,
      value: {
        items: [line()],
        customerId: null,
        discount: 0,
        discountKind: 'amount',
        payMethod: 'cash',
        tendered: 0,
        wholesale: false,
        updatedAt: Date.now() - DRAFT_TTL_MS - 1,
      },
    })
    expect(isDraftFresh(Date.now() - DRAFT_TTL_MS - 1)).toBe(false)
    expect(await loadFreshDraft<CartDraft>(DRAFT_CART)).toBeNull()
  })

  it('clearCart xóa draft', async () => {
    await persistCartDraft({
      items: [line()],
      customerId: null,
      discount: 0,
      discountKind: 'amount',
      payMethod: 'cash',
      tendered: 0,
      cashEntered: false,
      wholesale: false,
    })
    useApp.getState().clearCart()
    await vi.waitFor(async () => {
      expect(await loadFreshDraft<CartDraft>(DRAFT_CART)).toBeNull()
    })
  })

  it('clearDraft thủ công', async () => {
    await persistCartDraft({
      items: [line()],
      customerId: null,
      discount: 0,
      discountKind: 'amount',
      payMethod: 'cash',
      tendered: 0,
      cashEntered: false,
      wholesale: false,
    })
    await clearDraft(DRAFT_CART)
    expect(await loadFreshDraft<CartDraft>(DRAFT_CART)).toBeNull()
  })
})

describe('wholesale theo khách trên tổng giỏ', () => {
  it('chọn khách sỉ thì tính giá sỉ dù chưa bật nút', () => {
    expect(saleUsesWholesale(false, { wholesale: true })).toBe(true)
    expect(saleUsesWholesale(false, { wholesale: false })).toBe(false)
    expect(saleUsesWholesale(true, null)).toBe(true)
    const item = line()
    const p = { id: 'p1', name: 'SP', cat: '', price: 10000, cost: 6000, stock: 1, unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 8000, batches: [], createdAt: 1, updatedAt: 1 }
    expect(cartUnitPrice(item, p, saleUsesWholesale(false, { wholesale: true }))).toBe(8000)
  })
})


describe('nháp SP + PO', () => {
  it('persist còn hạn thì load được', async () => {
    await persistProductDraft({ isNew: true, productId: 'new', form: { name: 'Coca' } })
    const d = await loadFreshDraft<ProductDraft>(DRAFT_PRODUCT)
    expect(d?.form).toMatchObject({ name: 'Coca' })
    expect(isDraftFresh(d!.updatedAt)).toBe(true)

    await persistPoDraft({ supplierId: 's1', supplierName: 'NCC', rows: [{ productId: 'p1', qty: 2 }], note: 'ghi' })
    const po = await loadFreshDraft<PoDraft>(DRAFT_PO)
    expect(po?.supplierId).toBe('s1')
    expect(po?.rows).toHaveLength(1)
  })

  it('hết TTL thì xóa', async () => {
    await persistProductDraft({ isNew: true, productId: 'new', form: { name: 'X' } })
    const raw = await dbx.meta.get(DRAFT_PRODUCT)
    await dbx.meta.put({ key: DRAFT_PRODUCT, value: { ...raw!.value, updatedAt: Date.now() - DRAFT_TTL_MS - 1 } })
    expect(await loadFreshDraft<ProductDraft>(DRAFT_PRODUCT)).toBeNull()
  })
})
