import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dbx, DEFAULT_SETTINGS, setCurrentUser } from '@/core/db'
import { setAuthoritativeMoneyStockEnabled, resetAuthoritativeMoneyStockCacheForTests } from '@/core/authoritative/flag'
import { confirmCheckout } from '@/core/einvoice/checkoutFacade'
import { createUser } from '@/core/domain/auth'
import { initSyncEngine } from '@/core/sync/engine'
import type { Product } from '@/core/types'

function product(): Product {
  return {
    id: 'p1', name: 'SP', cat: 'Khác', price: 10000, cost: 6000, stock: 10,
    unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: 1, updatedAt: 1,
  }
}

const onlineDesc = Object.getOwnPropertyDescriptor(window.navigator, 'onLine')

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(), dbx.stockMoves.clear(),
    dbx.batches.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
    dbx.users.clear(), dbx.commandQueue.clear(), dbx.commandResults.clear(),
  ])
  resetAuthoritativeMoneyStockCacheForTests()
  await initSyncEngine()
  await dbx.meta.put({ key: 'settings', value: DEFAULT_SETTINGS })
})

afterEach(() => {
  if (onlineDesc) Object.defineProperty(window.navigator, 'onLine', onlineDesc)
  else Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
  resetAuthoritativeMoneyStockCacheForTests()
})

describe('confirmCheckout authoritative offline', () => {
  it('flag on + navigator.onLine false → pending, không ghi sales', async () => {
    await setAuthoritativeMoneyStockEnabled(true)
    await dbx.meta.put({ key: 'cloud:shopId', value: 'shop_test' })
    const owner = await createUser({ username: 'chu', name: 'Chủ', password: 'owner-1234', role: 'owner' })
    await setCurrentUser(owner)
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })

    const p = product()
    await dbx.products.put(p)
    const result = await confirmCheckout({
      items: [{ productId: p.id, qty: 1, unitName: 'cái', unitRatio: 1 }],
      products: [p],
      discount: 0,
      payMethod: 'cash',
      tendered: 10000,
      customerId: null,
      wholesale: false,
    })

    expect(result.status).toBe('pending')
    if (result.status === 'pending') {
      expect(result.banner).toMatch(/Chờ đồng bộ/)
      expect(result.commandId).toBeTruthy()
    }
    expect(await dbx.sales.count()).toBe(0)
    expect((await dbx.products.get(p.id))?.stock).toBe(10)
  })
})
