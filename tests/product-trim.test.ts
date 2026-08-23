import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import { addProduct, updateProduct } from '@/core/domain/inventory'

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(),
    dbx.stockMoves.clear(),
    dbx.syncQueue.clear(),
    dbx.appliedOps.clear(),
    dbx.meta.clear(),
  ])
  await initSyncEngine()
})

describe('product trim on save', () => {
  it('updateProduct trim barcode và unit', async () => {
    const { id } = await addProduct({ name: 'SP', cat: 'Khác', price: 1, cost: 1, stock: 0, unit: 'chai' })
    await updateProduct(id, { barcode: '  893  ', unit: '  lon  ' })
    const p = await dbx.products.get(id)
    expect(p?.barcode).toBe('893')
    expect(p?.unit).toBe('lon')
  })

  it('addProduct trim unit', async () => {
    const p = await addProduct({ name: 'SP', cat: 'Khác', price: 1, cost: 1, stock: 0, unit: '  chai  ' })
    expect(p.unit).toBe('chai')
    const stored = await dbx.products.get(p.id)
    expect(stored?.unit).toBe('chai')
  })
})
