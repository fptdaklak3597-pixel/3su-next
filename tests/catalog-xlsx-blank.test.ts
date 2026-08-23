import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import { applyCatalogDrafts, num, type CatalogDraft } from '@/web/lib/catalogXlsx'
import type { Product } from '@/core/types'

function mkProduct(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', name: 'Mì', cat: 'Khô', price: 100, cost: 60, stock: 10,
    unit: 'gói', barcode: '', expiry: '', units: [], wholesalePrice: 50,
    batches: [], createdAt: 1, updatedAt: 1, ...over,
  }
}

beforeEach(async () => {
  await Promise.all([dbx.products.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear()])
  await initSyncEngine()
})

describe('catalogXlsx blank cells', () => {
  it('num("") → null', () => {
    expect(num('')).toBeNull()
    expect(num('  ')).toBeNull()
    expect(num(0)).toBe(0)
    expect(num('12000')).toBe(12000)
  })

  it('update chỉ đè giá bán khi ô có giá trị — giữ cost/wholesale', async () => {
    await dbx.products.add(mkProduct({ stock: 10, cost: 60, wholesalePrice: 50, price: 100 }))
    const draft: CatalogDraft = {
      barcode: '', name: 'Mì', cat: '', unit: '',
      price: 120, cost: null, stock: null, wholesalePrice: null, expiry: '',
    }
    const stats = await applyCatalogDrafts([draft], [mkProduct()])
    expect(stats.updated).toBe(1)
    const p = (await dbx.products.get('p1'))!
    expect(p.price).toBe(120)
    expect(p.cost).toBe(60)
    expect(p.wholesalePrice).toBe(50)
  })
})
