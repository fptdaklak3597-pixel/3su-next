import { describe, it, expect, beforeEach } from 'vitest'
import { dbx, setCurrentUser } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import { confirmSale, voidSale } from '@/core/domain/sales'
import { addProduct, updateProduct, deleteProduct, saveGoodsReceipt, saveStocktake } from '@/core/domain/inventory'
import { registerThisDevice, removeDevice } from '@/core/domain/devices'
import { addCustomer, deleteCustomer, payDebt } from '@/core/domain/customers'
import { changePassword, createUser, deleteUser } from '@/core/domain/auth'
import { createPurchaseOrder } from '@/core/domain/purchase'
import { createSupplier, recordSupplierPayment } from '@/core/domain/suppliers'
import { createInvoice } from '@/core/domain/invoices'
import { createPricingRule } from '@/core/domain/pricing'
import type { Product, Customer, Sale, StocktakeRecord, GrCommitPayload } from '@/core/types'

/* ─── Factories ─── */
let seq = 0
function mkProduct(over: Partial<Product> = {}): Product {
  seq += 1
  return {
    id: 'p' + seq, name: 'Sản phẩm ' + seq, cat: 'Khác', price: 5000, cost: 3000,
    stock: 100, unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: Date.now(), updatedAt: Date.now(), ...over,
  }
}

function mkCustomer(over: Partial<Customer> = {}): Customer {
  seq += 1
  return {
    id: 'c' + seq, name: 'Khách ' + seq, phone: '', note: '', debt: 0, totalSpent: 0,
    orderCount: 0, createdAt: Date.now(), updatedAt: Date.now(), ...over,
  }
}

beforeEach(async () => {
  await Promise.all([dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
    dbx.debtPayments.clear(), dbx.goodsReceipts.clear(), dbx.stockMoves.clear(),
    dbx.stocktakes.clear(), dbx.notes.clear(), dbx.batches.clear(), dbx.priceLog.clear(),
    dbx.suppliers.clear(), dbx.supplierPayments.clear(), dbx.users.clear(),
    dbx.purchaseOrders.clear(), dbx.invoices.clear(), dbx.pricingRules.clear(),
    dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear()])
  await initSyncEngine()
})

describe('outbox — op sinh atomic trong domain', () => {
  it('confirmSale phát op sale.commit trong cùng transaction', async () => {
    const p = mkProduct({ price: 5000, cost: 3000, stock: 10 })
    await dbx.products.add(p)
    const { sale } = await confirmSale({
      items: [{ productId: p.id, qty: 2, unitName: 'cái', unitRatio: 1 }],
      products: [p], discount: 0, payMethod: 'cash', tendered: 20000, customerId: null, wholesale: false,
    })
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type)).toContain('sale.commit')
    const op = ops.find((o) => o.type === 'sale.commit')!
    expect((op.payload as Sale).id).toBe(sale.id)
    expect(await dbx.appliedOps.get(op.id)).toBeTruthy()
  })

  it('voidSale phát op sale.void', async () => {
    const p = mkProduct({ stock: 10 })
    await dbx.products.add(p)
    const { sale } = await confirmSale({
      items: [{ productId: p.id, qty: 2, unitName: 'cái', unitRatio: 1 }],
      products: [p], discount: 0, payMethod: 'cash', tendered: 20000, customerId: null, wholesale: false,
    })
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await voidSale(sale.id, 'test')
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type)).toContain('sale.void')
  })

  it('addProduct có tồn ban đầu → 2 op: product.upsert (KHÔNG stock) + stock.adjust init', async () => {
    const p = await addProduct({ name: 'SP mới', cat: 'Khác', price: 5000, cost: 3000, stock: 20, unit: 'cái' })
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type).sort()).toEqual(['product.upsert', 'stock.adjust'])
    const up = ops.find((o) => o.type === 'product.upsert')!
    expect((up.payload as { product: Record<string, unknown> }).product.stock).toBeUndefined()
    expect(p.hlc).toBe(up.hlc)
  })

  it('updateProduct chỉ gửi field hồ sơ đã đổi, không gửi price không đổi hay stock', async () => {
    const p = mkProduct({ name: 'Cũ', stock: 10, price: 5000 })
    await dbx.products.add(p)
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await updateProduct(p.id, { name: 'Tên mới', stock: 7, price: 5000 })
    const up = (await dbx.syncQueue.toArray()).find((o) => o.type === 'product.upsert')!
    const product = (up.payload as { product: Record<string, unknown> }).product
    expect(product.id).toBe(p.id)
    expect(product.name).toBe('Tên mới')
    expect(product.price).toBeUndefined()
    expect(product.stock).toBeUndefined()
    expect(product.batches).toBeUndefined()
  })

  it('registerThisDevice phát device.upsert không kèm isThis; removeDevice phát device.remove', async () => {
    await dbx.devices.clear()
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    const d = await registerThisDevice('Laptop')
    const up = (await dbx.syncQueue.toArray()).find((o) => o.type === 'device.upsert')!
    const payload = up.payload as { device: { deviceId: string; name: string; isThis?: boolean } }
    expect(payload.device.deviceId).toBe(d.deviceId)
    expect(payload.device.name).toBe('Laptop')
    expect(payload.device.isThis).toBeUndefined()
    expect(await dbx.appliedOps.get(up.id)).toBeTruthy()

    await dbx.devices.put({
      id: 'pd_x', deviceId: 'dev_other', name: 'X', platform: 'iOS', pairedAt: 1, lastSeen: 1,
    })
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await removeDevice('pd_x')
    const rm = (await dbx.syncQueue.toArray()).find((o) => o.type === 'device.remove')!
    expect((rm.payload as { deviceId: string }).deviceId).toBe('dev_other')
    expect(await dbx.devices.get('pd_x')).toBeUndefined()
  })

  it('registerThisDevice lần hai cùng tên không thêm op', async () => {
    await dbx.devices.clear()
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await registerThisDevice('Laptop')
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await registerThisDevice('Laptop')
    expect(await dbx.syncQueue.count()).toBe(0)
    await registerThisDevice('Máy thu ngân')
    expect((await dbx.syncQueue.toArray()).map((o) => o.type)).toEqual(['device.upsert'])
  })

  it('máy cũ chưa đẩy cloud: cùng tên vẫn phát một device.upsert', async () => {
    await dbx.devices.clear()
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await dbx.meta.delete('device:cloudAt')
    await dbx.devices.put({
      id: 'pd_old', deviceId: 'dev_old', name: 'Windows', platform: 'Windows',
      pairedAt: 1, lastSeen: 1, isThis: true,
    })
    await dbx.meta.put({ key: 'deviceId', value: 'dev_old' })
    await registerThisDevice()
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type)).toEqual(['device.upsert'])
  })

  it('updateProduct đổi tồn → tách stock.adjust delta; record nhận hlc = op.hlc', async () => {
    const p = mkProduct({ stock: 10 })
    await dbx.products.add(p)
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await updateProduct(p.id, { name: 'Tên mới', stock: 7 })
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type).sort()).toEqual(['product.upsert', 'stock.adjust'])
    const adjust = ops.find((o) => o.type === 'stock.adjust')!
    expect((adjust.payload as { delta: number }).delta).toBe(-3)
    const updated = await dbx.products.get(p.id)
    expect(updated!.stock).toBe(7)
    expect(updated!.hlc).toBeTruthy()
  })

  it('payDebt: trừ nợ + phiếu thu + op debt.pay, atomic', async () => {
    const c = mkCustomer({ debt: 15000 })
    await dbx.customers.add(c)
    await payDebt(c.id, 10000, 'thu nợ')
    expect((await dbx.customers.get(c.id))!.debt).toBe(5000)
    expect(await dbx.debtPayments.count()).toBe(1)
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type)).toContain('debt.pay')
  })

  it('deleteCustomer phát op customer.delete, xóa mềm', async () => {
    const c = await addCustomer({ name: 'Khách xóa', phone: '', note: '', wholesale: false })
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await deleteCustomer(c.id)
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type)).toEqual(['customer.delete'])
    expect((ops[0]!.payload as { customerId: string }).customerId).toBe(c.id)
    expect((await dbx.customers.get(c.id))!.deleted).toBe(true)
  })

  it('saveGoodsReceipt phát gr.commit với patches mang batch id THẬT đã tạo', async () => {
    const p = mkProduct({ stock: 0, cost: 0 })
    await dbx.products.add(p)
    await saveGoodsReceipt({
      supplier: 'NCC A', supplierId: 'sp1', date: '2026-08-14', expiry: '2026-12-31', note: '',
      rows: [{ productId: p.id, name: p.name, unit: 'cái', unitRatio: 1, qty: 5, cost: 4000, expiry: '2026-12-31' }],
    })
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type)).toContain('gr.commit')
    const op = ops.find((o) => o.type === 'gr.commit')!
    const payload = op.payload as GrCommitPayload
    expect(payload.patches).toHaveLength(1)
    const patch = payload.patches[0]
    expect(patch.addQty).toBe(5)
    expect(patch.batches).toHaveLength(1)
    const batchId = patch.batches[0].id
    expect(await dbx.batches.get(batchId)).toBeTruthy()
    expect(payload.gr.id).toBeTruthy()
    expect((await dbx.products.get(p.id))!.grHlc).toBe(op.hlc)
  })

  it('deleteProduct phát op product.delete, không nhét stock vào upsert', async () => {
    const p = mkProduct({ stock: 10 })
    await dbx.products.add(p)
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await deleteProduct(p.id)
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type)).toEqual(['product.delete'])
    expect((ops[0]!.payload as { productId: string }).productId).toBe(p.id)
    expect((await dbx.products.get(p.id))!.deleted).toBe(true)
  })

  it('createUser / changePassword / deleteUser phát op user.*', async () => {
    const owner = await createUser({ username: 'owner', name: 'Chủ', password: '1234', role: 'owner' })
    await setCurrentUser(owner)
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()

    const u = await createUser({ username: 'an', name: 'An', password: '1111', role: 'staff' })
    const created = (await dbx.syncQueue.toArray()).find((o) => o.type === 'user.upsert')
    expect(created).toBeTruthy()
    expect((created!.payload as { user: { id: string } }).user.id).toBe(u.id)
    expect(u.hlc).toBe(created!.hlc)

    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await changePassword(u.id, '2222')
    const pw = (await dbx.syncQueue.toArray()).find((o) => o.type === 'user.password')
    expect(pw).toBeTruthy()
    expect((pw!.payload as { userId: string }).userId).toBe(u.id)

    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await deleteUser(u.id)
    const del = (await dbx.syncQueue.toArray()).find((o) => o.type === 'user.delete')
    expect(del).toBeTruthy()
    expect((del!.payload as { userId: string }).userId).toBe(u.id)
    expect((await dbx.users.get(u.id))!.deleted).toBe(true)
  })

  it('saveStocktake phát stocktake.commit + set stockSetHlc trên product', async () => {
    const p = mkProduct({ stock: 100, cost: 3000 })
    await dbx.products.add(p)
    await saveStocktake([{ productId: p.id, name: p.name, system: 100, actual: 95 }], 'kiểm kê')
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type)).toContain('stocktake.commit')
    const op = ops.find((o) => o.type === 'stocktake.commit')!
    expect((op.payload as StocktakeRecord).id).toBeTruthy()
    expect((await dbx.products.get(p.id))!.stockSetHlc).toBe(op.hlc)
  })

  it('createPurchaseOrder phát po.upsert', async () => {
    const po = await createPurchaseOrder({
      supplierId: 'sp1', supplierName: 'NCC A',
      rows: [{ productId: 'p1', name: 'SP', unit: 'cái', qty: 2, cost: 4000 }],
    })
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type)).toEqual(['po.upsert'])
    expect((ops[0]!.payload as { id: string }).id).toBe(po.id)
    expect(po.hlc).toBe(ops[0]!.hlc)
  })

  it('recordSupplierPayment phát supplier.pay', async () => {
    const s = await createSupplier({ name: 'NCC trả' })
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    const pay = await recordSupplierPayment({ supplierId: s.id, amount: 3000, note: 'trả 3k' })
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type)).toEqual(['supplier.pay'])
    expect((ops[0]!.payload as { id: string; amount: number }).id).toBe(pay.id)
    expect((ops[0]!.payload as { amount: number }).amount).toBe(3000)
  })

  it('createInvoice phát invoice.upsert', async () => {
    const inv = await createInvoice({ code: 'HD-1', type: 'import', amount: 10000, tax: 1000 })
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type)).toEqual(['invoice.upsert'])
    expect((ops[0]!.payload as { id: string }).id).toBe(inv.id)
    expect(inv.hlc).toBe(ops[0]!.hlc)
  })

  it('createPricingRule phát pricing.upsert', async () => {
    const rule = await createPricingRule({ name: 'Cafe 40%', cat: 'Cafe', marginPct: 40, roundTo: 1000 })
    const ops = await dbx.syncQueue.toArray()
    expect(ops.map((o) => o.type)).toEqual(['pricing.upsert'])
    expect((ops[0]!.payload as { id: string }).id).toBe(rule.id)
    expect(rule.hlc).toBe(ops[0]!.hlc)
  })
})