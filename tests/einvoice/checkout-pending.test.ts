import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dbx, DEFAULT_SETTINGS, setCurrentUser } from '@/core/db'
import { setAuthoritativeMoneyStockEnabled, resetAuthoritativeMoneyStockCacheForTests } from '@/core/authoritative/flag'
import { confirmCheckout } from '@/core/einvoice/checkoutFacade'
import { postShopCommand } from '@/core/einvoice/cloudApi'
import { projectAuthoritativeSale } from '@/core/einvoice/projectSale'
import { saleFromAuthoritativePayload } from '@/core/einvoice/saleMapper'
import { createUser } from '@/core/domain/auth'
import { initSyncEngine } from '@/core/sync/engine'
import type { Product } from '@/core/types'

vi.mock('@/core/einvoice/cloudApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/einvoice/cloudApi')>()
  return {
    ...actual,
    postShopCommand: vi.fn(async () => {
      throw new Error('postShopCommand chưa mock')
    }),
  }
})

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
  vi.mocked(postShopCommand).mockReset()
  vi.mocked(postShopCommand).mockImplementation(async () => {
    throw new Error('postShopCommand chưa mock')
  })
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

describe('projectAuthoritativeSale', () => {
  it('ghi sales + trừ tồn; lần 2 cùng id không trừ thêm', async () => {
    const p = product()
    await dbx.products.put(p)
    const sale = saleFromAuthoritativePayload({
      id: 'sale_auth_1',
      items: [{
        productId: p.id, name: p.name, qty: 2, unitName: 'cái', unitRatio: 1, price: 10000, cost: 6000,
      }],
      total: 20000, profit: 8000, discount: 0, payMethod: 'cash', debtAmount: 0,
      occurredAt: '2026-08-30T10:00:00.000Z',
    }, 20000)

    await projectAuthoritativeSale(sale)
    expect(await dbx.sales.count()).toBe(1)
    expect((await dbx.products.get(p.id))?.stock).toBe(8)
    const moves = await dbx.stockMoves.where('type').equals('sale').toArray()
    expect(moves).toHaveLength(1)
    expect(moves[0]!.qty).toBe(-2)
    expect(moves[0]!.id).toBe('mv_auth_sale_auth_1_p1')

    await projectAuthoritativeSale(sale)
    expect(await dbx.sales.count()).toBe(1)
    expect((await dbx.products.get(p.id))?.stock).toBe(8)
    expect(await dbx.stockMoves.where('type').equals('sale').count()).toBe(1)
  })
})

describe('confirmCheckout authoritative online', () => {
  it('SaleCommitted → ghi sổ local rồi committed', async () => {
    await setAuthoritativeMoneyStockEnabled(true)
    await dbx.meta.put({ key: 'cloud:shopId', value: 'shop_test' })
    const owner = await createUser({ username: 'chu', name: 'Chủ', password: 'owner-1234', role: 'owner' })
    await setCurrentUser(owner)
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })

    const p = product()
    await dbx.products.put(p)

    vi.mocked(postShopCommand).mockImplementation(async (e) => ({
      commandId: e.id,
      status: 'accepted',
      events: [{
        id: 'ev1', seq: 1, shopId: 'shop_test', commandId: e.id,
        type: 'SaleCommitted', occurredAt: '2026-08-30T10:00:00.000Z',
        committedAt: '2026-08-30T10:00:00.000Z', schemaVersion: 1,
        payload: {
          id: 'sale_cloud_1',
          items: [{
            productId: p.id, name: p.name, qty: 1, unitName: 'cái', unitRatio: 1, price: 10000, cost: 6000,
          }],
          total: 10000, profit: 4000, discount: 0, payMethod: 'cash', debtAmount: 0,
          occurredAt: '2026-08-30T10:00:00.000Z',
        },
      }],
    }))

    const result = await confirmCheckout({
      items: [{ productId: p.id, qty: 1, unitName: 'cái', unitRatio: 1 }],
      products: [p],
      discount: 0,
      payMethod: 'cash',
      tendered: 10000,
      customerId: null,
      wholesale: false,
    })

    expect(result.status).toBe('committed')
    expect(await dbx.sales.count()).toBe(1)
    expect((await dbx.sales.get('sale_cloud_1'))?.total).toBe(10000)
    expect((await dbx.products.get(p.id))?.stock).toBe(9)
    expect(await dbx.stockMoves.where('type').equals('sale').count()).toBe(1)
  })
})
