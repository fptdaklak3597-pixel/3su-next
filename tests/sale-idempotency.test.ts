import { beforeEach, describe, expect, it } from 'vitest'
import { dbx, DEFAULT_SETTINGS } from '@/core/db'
import { checkoutFingerprint, confirmSale } from '@/core/domain/sales'
import { DRAFT_CART, loadFreshDraft, persistCartDraft } from '@/core/domain/drafts'
import { initSyncEngine } from '@/core/sync/engine'
import type { Product } from '@/core/types'

function product(stock = 100): Product {
  return {
    id: 'p1', name: 'SP', cat: 'Khác', price: 10000, cost: 6000, stock,
    unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: 1, updatedAt: 1,
  }
}

const items = [{ productId: 'p1', qty: 2, unitName: 'cái', unitRatio: 1 }]

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(), dbx.stockMoves.clear(),
    dbx.batches.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
  ])
  await initSyncEngine()
  await dbx.meta.put({ key: 'settings', value: { ...DEFAULT_SETTINGS, allowNegativeStock: false } })
})

describe('confirmSale idempotency + xóa giỏ trong TX', () => {
  it('cùng key chỉ tạo một đơn và trừ kho một lần', async () => {
    const p = product(10)
    await dbx.products.put(p)
    const key = checkoutFingerprint({
      items, discount: 0, payMethod: 'cash', tendered: 20000, customerId: null, wholesale: false,
    })
    const input = {
      items, products: [p], discount: 0, payMethod: 'cash' as const, tendered: 20000,
      customerId: null, wholesale: false, idempotencyKey: key,
    }
    const a = await confirmSale(input)
    const b = await confirmSale(input)
    expect(b.sale.id).toBe(a.sale.id)
    expect(await dbx.sales.count()).toBe(1)
    expect((await dbx.products.get('p1'))?.stock).toBe(8)
  })

  it('xóa draft giỏ trong TX dù chưa gọi store.clearCart', async () => {
    const p = product(10)
    await dbx.products.put(p)
    await persistCartDraft({
      items, customerId: null, discount: 0, discountKind: 'amount',
      payMethod: 'cash', tendered: 20000, cashEntered: false, wholesale: false,
    })
    expect(await loadFreshDraft(DRAFT_CART)).not.toBeNull()
    await confirmSale({
      items, products: [p], discount: 0, payMethod: 'cash', tendered: 20000,
      customerId: null, wholesale: false,
    })
    expect(await loadFreshDraft(DRAFT_CART)).toBeNull()
  })

  it('idempotent retry vẫn xóa draft giỏ', async () => {
    const p = product(10)
    await dbx.products.put(p)
    const key = checkoutFingerprint({
      items, discount: 0, payMethod: 'cash', tendered: 20000, customerId: null, wholesale: false,
    })
    const input = {
      items, products: [p], discount: 0, payMethod: 'cash' as const, tendered: 20000,
      customerId: null, wholesale: false, idempotencyKey: key,
    }
    await confirmSale(input)
    await persistCartDraft({
      items, customerId: null, discount: 0, discountKind: 'amount',
      payMethod: 'cash', tendered: 20000, cashEntered: false, wholesale: false,
    })
    expect(await loadFreshDraft(DRAFT_CART)).not.toBeNull()
    await confirmSale(input)
    expect(await loadFreshDraft(DRAFT_CART)).toBeNull()
    expect(await dbx.sales.count()).toBe(1)
  })
})
