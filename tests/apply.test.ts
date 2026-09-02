import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine, makeOp, enqueueOp } from '@/core/sync/engine'
import {
  applyOps,
  getBlockedOps,
  getPoisonedOps,
  SyncDependencyError,
} from '@/core/sync/apply'
import { MAX_STOCK_QTY_DELTA } from '@/core/domain/inventory'
import { hlcString } from '@/core/sync/hlc'
import type {
  Product, Customer, Sale, SyncOp, DebtPayment, GoodsReceipt,
  ProductBatch, PriceLogEntry, GrCommitPayload, Note, Supplier, User,
  PurchaseOrder, InvoiceRecord, PricingRule, SupplierPayment,
} from '@/core/types'

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

function mkSale(productId: string, qty: number, over: Partial<Sale> = {}): Sale {
  seq += 1
  return {
    id: 's' + seq,
    items: [{ productId, name: 'x', qty, price: 10000, cost: 6000, unit: 'cái', unitRatio: 1 }],
    total: qty * 10000, profit: qty * 4000, discount: 0, payMethod: 'cash',
    tendered: qty * 10000, change: 0, debtAmount: 0, customerId: null,
    date: new Date().toISOString(), ...over,
  }
}

/** Giả op máy khác: giữ hlc của makeOp, đổi deviceId (không persistOp — op remote không nằm trong appliedOps). */
function remoteOp(type: SyncOp['type'], payload: unknown, hlc?: string): SyncOp {
  const op = makeOp(type, payload)
  return { ...op, deviceId: 'dev_remote', ...(hlc ? { hlc, id: hlc } : {}) }
}

beforeEach(async () => {
  await Promise.all([dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
    dbx.debtPayments.clear(), dbx.goodsReceipts.clear(), dbx.stockMoves.clear(),
    dbx.stocktakes.clear(), dbx.notes.clear(), dbx.batches.clear(), dbx.priceLog.clear(),
    dbx.suppliers.clear(), dbx.supplierPayments.clear(), dbx.users.clear(),
    dbx.purchaseOrders.clear(), dbx.invoices.clear(), dbx.pricingRules.clear(),
    dbx.devices.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear()])
  await initSyncEngine()
})

describe('applyOps — idempotent + delta + LWW', () => {
  it('áp op 2 lần chỉ có tác dụng 1 lần (appliedOps)', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10 }))
    const op = remoteOp('stock.adjust', { productId: 'p1', delta: -3, reason: 'test' })
    expect(await applyOps([op])).toBe(1)
    expect(await applyOps([op])).toBe(0)
    expect((await dbx.products.get('p1'))!.stock).toBe(7)
  })

  it('stock.adjust delta quá lớn → poison, không đổi tồn', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10 }))
    const op = remoteOp('stock.adjust', { productId: 'p1', delta: MAX_STOCK_QTY_DELTA + 1, reason: 'edit' })
    expect(await applyOps([op])).toBe(0)
    expect((await dbx.products.get('p1'))!.stock).toBe(10)
    expect((await getPoisonedOps()).some((p) => /lệch tồn/i.test(p.message))).toBe(true)
  })

  it('stocktake.commit diff quá lớn → poison, không đổi tồn', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10 }))
    const op = remoteOp('stocktake.commit', {
      id: 'st_huge', date: '2026-08-27',
      rows: [{ productId: 'p1', name: 'SP', system: 10, actual: 10 + MAX_STOCK_QTY_DELTA + 1, diff: MAX_STOCK_QTY_DELTA + 1 }],
      note: '', ts: Date.now(),
    })
    expect(await applyOps([op])).toBe(0)
    expect((await dbx.products.get('p1'))!.stock).toBe(10)
    expect((await getPoisonedOps()).some((p) => /lệch tồn/i.test(p.message))).toBe(true)
  })

  it('sale.commit remote: thêm đơn + trừ kho theo items + cộng nợ/totalSpent khách', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10 }))
    await dbx.customers.put(mkCustomer({ id: 'c1', debt: 0, totalSpent: 0, orderCount: 0 }))
    const sale: Sale = {
      id: 's_remote_1', total: 20000, profit: 8000, discount: 0, payMethod: 'cash',
      tendered: 5000, change: 0, debtAmount: 15000, customerId: 'c1',
      date: new Date().toISOString(), synced: false,
      items: [{ productId: 'p1', name: 'SP', qty: 2, price: 10000, cost: 6000, unit: 'cái', unitRatio: 1 }],
    }
    await applyOps([remoteOp('sale.commit', sale)])
    expect((await dbx.products.get('p1'))!.stock).toBe(8)
    const c = (await dbx.customers.get('c1'))!
    expect(c.debt).toBe(15000)
    expect(c.totalSpent).toBe(20000)
    expect(c.orderCount).toBe(1)
    expect(await dbx.sales.get('s_remote_1')).toBeTruthy()
  })

  it('sale.commit giữ giá dòng biên lai — không định giá lại từ catalog máy nhận', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10, price: 5000, cost: 3000 }))
    await dbx.customers.put(mkCustomer({ id: 'c1', debt: 0, totalSpent: 0, orderCount: 0 }))
    const sale: Sale = {
      id: 's_receipt_1', total: 1, profit: 0, discount: 0, payMethod: 'cash',
      tendered: 5000, change: 0, debtAmount: 0, customerId: 'c1',
      date: new Date().toISOString(), synced: false,
      items: [{ productId: 'p1', name: 'SP', qty: 2, price: 10000, cost: 6000, unit: 'cái', unitRatio: 1 }],
    }
    await applyOps([remoteOp('sale.commit', sale)])
    const saved = (await dbx.sales.get('s_receipt_1'))!
    expect(saved.items[0].price).toBe(10000)
    expect(saved.total).toBe(20000)
    expect(saved.debtAmount).toBe(15000)
    expect((await dbx.customers.get('c1'))!.debt).toBe(15000)
    expect((await dbx.customers.get('c1'))!.totalSpent).toBe(20000)
  })

  it('sale.commit bỏ qua total/debtAmount giả — tính lại từ items + tendered', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10 }))
    await dbx.customers.put(mkCustomer({ id: 'c1', debt: 0, totalSpent: 0, orderCount: 0 }))
    const forged: Sale = {
      id: 's_forge_1',
      // client gửi tổng/nợ sai cố ý
      total: 1, profit: 999999, discount: 0, payMethod: 'cash',
      tendered: 5000, change: 0, debtAmount: 0, customerId: 'c1',
      date: new Date().toISOString(), synced: false,
      items: [{ productId: 'p1', name: 'SP', qty: 2, price: 10000, cost: 6000, unit: 'cái', unitRatio: 1 }],
    }
    await applyOps([remoteOp('sale.commit', forged)])
    const saved = (await dbx.sales.get('s_forge_1'))!
    expect(saved.total).toBe(20000)
    expect(saved.profit).toBe(8000)
    expect(saved.debtAmount).toBe(15000)
    const c = (await dbx.customers.get('c1'))!
    expect(c.debt).toBe(15000)
    expect(c.totalSpent).toBe(20000)
  })

  it('sale.commit ghi nợ không khách → poison, không trừ kho', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10 }))
    const sale: Sale = {
      id: 's_nodebtcust', total: 10000, profit: 4000, discount: 0, payMethod: 'debt',
      tendered: 0, change: 0, debtAmount: 10000, customerId: null,
      date: new Date().toISOString(), synced: false,
      items: [{ productId: 'p1', name: 'SP', qty: 1, price: 10000, cost: 6000, unit: 'cái', unitRatio: 1 }],
    }
    expect(await applyOps([remoteOp('sale.commit', sale)])).toBe(0)
    expect((await dbx.products.get('p1'))!.stock).toBe(10)
    expect(await dbx.sales.get('s_nodebtcust')).toBeUndefined()
    const poisoned = await getPoisonedOps()
    expect(poisoned.some((p) => /khách|ghi nợ/i.test(p.message))).toBe(true)
  })

  it('sale.commit remote đã có sale id local → bỏ qua hoàn toàn (không trừ kho đúp)', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 8 }))
    await dbx.customers.put(mkCustomer({ id: 'c1', debt: 15000, totalSpent: 20000, orderCount: 1 }))
    const sale = mkSale('p1', 2, { id: 's_remote_1', customerId: 'c1', debtAmount: 15000, total: 20000 })
    await dbx.sales.put(sale)
    await applyOps([remoteOp('sale.commit', sale)])
    expect((await dbx.products.get('p1'))!.stock).toBe(8)
    expect((await dbx.customers.get('c1'))!.orderCount).toBe(1)
  })

  it('sale.void remote: hoàn kho, hoàn nợ, đánh dấu voided; đơn đã voided thì bỏ qua', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 8 }))
    await dbx.customers.put(mkCustomer({ id: 'c1', debt: 15000, totalSpent: 20000, orderCount: 1 }))
    const sale: Sale = {
      id: 's_remote_1', total: 20000, profit: 8000, discount: 0, payMethod: 'cash',
      tendered: 5000, change: 0, debtAmount: 15000, customerId: 'c1',
      date: new Date().toISOString(), synced: false,
      items: [{ productId: 'p1', name: 'SP', qty: 2, price: 10000, cost: 6000, unit: 'cái', unitRatio: 1 }],
    }
    await dbx.sales.put(sale)
    await applyOps([remoteOp('sale.void', { saleId: 's_remote_1', reason: 'test' })])
    expect((await dbx.products.get('p1'))!.stock).toBe(10)
    expect((await dbx.customers.get('c1'))!.debt).toBe(0)
    expect((await dbx.customers.get('c1'))!.totalSpent).toBe(0)
    expect((await dbx.sales.get('s_remote_1'))!.voided).toBe(true)
    await applyOps([remoteOp('sale.void', { saleId: 's_remote_1', reason: 'test2' })])
    expect((await dbx.products.get('p1'))!.stock).toBe(10)
  })

  it('sale.void đã voided nhưng thiếu dp_void → vá phiếu hoàn, không trừ nợ lần nữa', async () => {
    const { reconcileFrom } = await import('@/core/domain/reconcile')
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10 }))
    await dbx.customers.put(mkCustomer({ id: 'c1', debt: 0, totalSpent: 0, orderCount: 0 }))
    const sale: Sale = {
      id: 's_voided', total: 100, profit: 40, discount: 0, payMethod: 'debt',
      tendered: 0, change: 0, debtAmount: 100, customerId: 'c1',
      date: new Date().toISOString(), synced: false, voided: true,
      items: [{ productId: 'p1', name: 'SP', qty: 1, price: 100, cost: 60, unit: 'cái', unitRatio: 1 }],
    }
    await dbx.sales.put(sale)
    const pay: DebtPayment = {
      id: 'dp_paid', customerId: 'c1', amount: 100,
      date: new Date().toISOString(), note: 'Thu nợ',
    }
    await dbx.debtPayments.add(pay)

    await applyOps([remoteOp('sale.void', { saleId: 's_voided', reason: 'repair' })])
    const voucher = await dbx.debtPayments.get('dp_void_s_voided')
    expect(voucher?.amount).toBe(-100)
    expect((await dbx.customers.get('c1'))!.debt).toBe(0)
    expect((await dbx.products.get('p1'))!.stock).toBe(10)

    const report = reconcileFrom(
      await dbx.products.toArray(),
      await dbx.customers.toArray(),
      await dbx.sales.toArray(),
      await dbx.stockMoves.toArray(),
      await dbx.debtPayments.toArray(),
    )
    expect(report.debtDrifts).toEqual([])
  })

  it('stock.adjust giao hoán: [-3, +5] và [+5, -3] cho cùng kết quả', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10 }))
    await applyOps([
      remoteOp('stock.adjust', { productId: 'p1', delta: -3, reason: 'a' }),
      remoteOp('stock.adjust', { productId: 'p1', delta: 5, reason: 'b' }),
    ])
    const expected = (await dbx.products.get('p1'))!.stock

    await dbx.products.clear()
    await dbx.appliedOps.clear()
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10 }))
    await applyOps([
      remoteOp('stock.adjust', { productId: 'p1', delta: 5, reason: 'b' }),
      remoteOp('stock.adjust', { productId: 'p1', delta: -3, reason: 'a' }),
    ])
    expect((await dbx.products.get('p1'))!.stock).toBe(expected)
  })

  it('product.upsert field-level: hai op từng phần giữ cả name lẫn price, stock không đổi', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', name: 'Cũ', price: 5000, stock: 10 }))
    await applyOps([
      remoteOp('product.upsert', { product: { id: 'p1', name: 'A' } }, hlcString(2000, 0, 'dev_x')),
      remoteOp('product.upsert', { product: { id: 'p1', price: 9000 } }, hlcString(3000, 0, 'dev_y')),
    ])
    const p = (await dbx.products.get('p1'))!
    expect(p.name).toBe('A')
    expect(p.price).toBe(9000)
    expect(p.stock).toBe(10)
  })

  it('device.upsert đặt isThis theo máy này; device.remove không gỡ máy này', async () => {
    const thisId = (await dbx.meta.get('deviceId'))!.value as string
    await applyOps([
      remoteOp('device.upsert', { device: {
        id: 'pd1', deviceId: thisId, name: 'Máy này', platform: 'Windows',
        pairedAt: 1, lastSeen: 1, isThis: false,
      } }),
      remoteOp('device.upsert', { device: {
        id: 'pd2', deviceId: 'dev_other', name: 'Máy kia', platform: 'iOS',
        pairedAt: 1, lastSeen: 1,
      } }),
    ])
    expect((await dbx.devices.get('pd1'))!.isThis).toBe(true)
    expect((await dbx.devices.get('pd2'))!.isThis).toBe(false)
    await applyOps([remoteOp('device.remove', { deviceId: thisId })])
    expect(await dbx.devices.get('pd1')).toBeTruthy()
    await applyOps([remoteOp('device.remove', { deviceId: 'dev_other' })])
    expect(await dbx.devices.get('pd2')).toBeUndefined()
  })

  it('product.upsert LWW: op hlc mới hơn thắng; KHÔNG đè stock/batches local', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10, hlc: hlcString(1000, 0, 'dev_a') }))
    const newer = remoteOp('product.upsert',
      { product: { id: 'p1', name: 'Tên mới', price: 9000 } },
      hlcString(9_999_999_999_999, 0, 'dev_remote'))
    await applyOps([newer])
    const p = (await dbx.products.get('p1'))!
    expect(p.name).toBe('Tên mới')
    expect(p.stock).toBe(10)
    const older = remoteOp('product.upsert', { product: { id: 'p1', name: 'Tên cũ' } }, hlcString(1, 0, 'dev_z'))
    await applyOps([older])
    expect((await dbx.products.get('p1'))!.name).toBe('Tên mới')
  })

  it('product.upsert: op tên cũ hơn vẫn vào khi máy này mới sửa giá', async () => {
    const priceHlc = hlcString(5000, 0, 'dev_local')
    await dbx.products.put(mkProduct({
      id: 'p1', name: 'Cũ', price: 12000, stock: 18,
      hlc: priceHlc, fieldHlc: { price: priceHlc, updatedAt: priceHlc },
    }))
    await applyOps([
      remoteOp('product.upsert', { product: { id: 'p1', name: 'LOOP20 nước A' } }, hlcString(2000, 0, 'dev_a')),
    ])
    const p = (await dbx.products.get('p1'))!
    expect(p.name).toBe('LOOP20 nước A')
    expect(p.price).toBe(12000)
    expect(p.stock).toBe(18)
  })

  it('stocktake.commit remote không hoàn đơn máy kia đã áp (hết trong outbox)', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 17 }))
    await dbx.sales.put(mkSale('p1', 1, { id: 's_a' }))
    const st = remoteOp('stocktake.commit', {
      id: 'st_stale', date: '2026-08-18',
      rows: [{ productId: 'p1', name: 'SP', system: 18, actual: 18, diff: 0 }],
      note: 'máy kia đếm khi chưa thấy đơn đã đẩy', ts: Date.now(),
    })
    await applyOps([st])
    expect((await dbx.products.get('p1'))!.stock).toBe(17)
  })

  it('stocktake.commit remote KHÔNG nuốt delta local chưa đẩy (quy tắc delta treo)', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 8 }))
    await enqueueOp('sale.commit', mkSale('p1', 2))
    const st = remoteOp('stocktake.commit', {
      id: 'st1', date: '2026-08-14',
      rows: [{ productId: 'p1', name: 'SP', system: 10, actual: 100, diff: 90 }],
      note: '', ts: Date.now(),
    })
    await applyOps([st])
    expect((await dbx.products.get('p1'))!.stock).toBe(98)
    expect(await dbx.stocktakes.get('st1')).toBeTruthy()
  })

  it('debt.pay remote: thêm phiếu thu + trừ nợ; trùng id phiếu → bỏ qua', async () => {
    await dbx.customers.put(mkCustomer({ id: 'c1', debt: 15000 }))
    const dp: DebtPayment = { id: 'dp1', customerId: 'c1', amount: 10000, date: new Date().toISOString(), note: 'test' }
    await applyOps([remoteOp('debt.pay', dp)])
    expect((await dbx.customers.get('c1'))!.debt).toBe(5000)
    expect(await dbx.debtPayments.get('dp1')).toBeTruthy()
    await applyOps([remoteOp('debt.pay', dp)])
    expect((await dbx.customers.get('c1'))!.debt).toBe(5000)
  })

  it('debt.pay làm tròn amount về VND nguyên', async () => {
    await dbx.customers.put(mkCustomer({ id: 'c1', debt: 10000 }))
    const dp: DebtPayment = {
      id: 'dp_frac', customerId: 'c1', amount: 1000.6,
      date: new Date().toISOString(), note: 'lẻ',
    }
    await applyOps([remoteOp('debt.pay', dp)])
    expect((await dbx.debtPayments.get('dp_frac'))!.amount).toBe(1001)
    expect((await dbx.customers.get('c1'))!.debt).toBe(8999)
  })

  it('gr.commit rows rỗng + patches không cộng kho', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10, cost: 3000 }))
    const batch: ProductBatch = { id: 'bt1', qty: 5, remain: 5, cost: 4000, expiry: '2026-12-31', date: '2026-08-14' }
    const pl: PriceLogEntry = { id: 'pl1', productId: 'p1', supId: 'sp1', supName: 'NCC A', cost: 4000, ts: Date.now() }
    const gr: GoodsReceipt = {
      id: 'gr1', code: 'NK-1', supplier: 'NCC A', supplierId: 'sp1', date: '2026-08-14',
      expiry: '2026-12-31', note: '', rows: [], total: 20000, ts: Date.now(),
    }
    const payload: GrCommitPayload = {
      gr,
      patches: [{ productId: 'p1', addQty: 5, newCost: 4000, newPrice: 9000, expiry: '2026-12-31', batches: [batch], priceLogRows: [pl] }],
    }
    expect(await applyOps([remoteOp('gr.commit', payload)])).toBe(0)
    expect((await dbx.products.get('p1'))!.stock).toBe(10)
    expect(await dbx.goodsReceipts.get('gr1')).toBeUndefined()
    const poisoned = await getPoisonedOps()
    expect(poisoned.some((p) => /dòng hàng/i.test(p.message))).toBe(true)
  })

  it('gr.commit bỏ qua purchasedDelta giả — dùng Σ(qty×cost) từ rows', async () => {
    await dbx.products.put(mkProduct({ id: 'p1', stock: 10, cost: 3000 }))
    await dbx.suppliers.put({
      id: 'sp1', name: 'NCC', phone: '', address: '', note: '', leadDays: 0,
      debt: 0, totalPurchased: 0, orderCount: 0, createdAt: 1, updatedAt: 1,
    })
    const gr: GoodsReceipt = {
      id: 'gr_forge', code: 'NK-F', supplier: 'NCC', supplierId: 'sp1', date: '2026-08-14',
      expiry: '', note: '',
      rows: [{ productId: 'p1', name: 'SP', unit: 'cái', unitRatio: 1, qty: 5, cost: 4000, expiry: '' }],
      total: 1, // giả
      ts: Date.now(),
    }
    const payload: GrCommitPayload = {
      gr,
      patches: [{ productId: 'p1', addQty: 5, newCost: 3500, batches: [], priceLogRows: [] }],
      supplierDelta: { supplierId: 'sp1', debtDelta: 0, purchasedDelta: 999999 },
    }
    await applyOps([remoteOp('gr.commit', payload)])
    expect((await dbx.goodsReceipts.get('gr_forge'))!.total).toBe(20000)
    expect((await dbx.suppliers.get('sp1'))!.totalPurchased).toBe(20000)
  })

  it('settings.set LWW theo meta hlc:settings', async () => {
    await applyOps([remoteOp('settings.set', { key: 'settings', value: { theme: 'dark' } }, hlcString(2000, 0, 'dev_x'))])
    expect((await dbx.meta.get('settings'))!.value).toEqual({ theme: 'dark' })
    await applyOps([remoteOp('settings.set', { key: 'settings', value: { theme: 'light' } }, hlcString(1000, 0, 'dev_y'))])
    expect((await dbx.meta.get('settings'))!.value).toEqual({ theme: 'dark' })
    await applyOps([remoteOp('settings.set', { key: 'settings', value: { theme: 'system' } }, hlcString(3000, 0, 'dev_z'))])
    expect((await dbx.meta.get('settings'))!.value).toEqual({ theme: 'system' })
  })

  it('note.upsert LWW + note.delete', async () => {
    const n1: Note = { id: 'n1', text: 'ghi chú mới', date: new Date().toISOString(), type: 'note', done: false, pinned: false }
    await applyOps([remoteOp('note.upsert', n1, hlcString(2000, 0, 'dev_x'))])
    expect((await dbx.notes.get('n1'))!.text).toBe('ghi chú mới')
    await applyOps([remoteOp('note.upsert', { ...n1, text: 'cũ hơn' }, hlcString(1000, 0, 'dev_y'))])
    expect((await dbx.notes.get('n1'))!.text).toBe('ghi chú mới')
    await applyOps([remoteOp('note.delete', { noteId: 'n1' })])
    expect((await dbx.notes.get('n1'))!.deleted).toBe(true)
  })

  it('customer.upsert LWW không đè nợ/totalSpent/orderCount; customer.delete soft', async () => {
    await dbx.customers.put(mkCustomer({ id: 'c1', debt: 1000, totalSpent: 5000, orderCount: 2 }))
    await applyOps([remoteOp('customer.upsert', { customer: { id: 'c1', name: 'Khách mới', phone: '1', note: '', wholesale: false } }, hlcString(2000, 0, 'dev_x'))])
    const c = (await dbx.customers.get('c1'))!
    expect(c.name).toBe('Khách mới')
    expect(c.debt).toBe(1000)
    expect(c.totalSpent).toBe(5000)
    expect(c.orderCount).toBe(2)
    await applyOps([remoteOp('customer.delete', { customerId: 'c1' }, hlcString(3000, 0, 'dev_x'))])
    expect((await dbx.customers.get('c1'))!.deleted).toBe(true)
  })

  it('product.delete soft; supplier.upsert LWW không đè công nợ', async () => {
    await dbx.products.put(mkProduct({ id: 'p1' }))
    await applyOps([remoteOp('product.delete', { productId: 'p1' }, hlcString(2000, 0, 'dev_x'))])
    expect((await dbx.products.get('p1'))!.deleted).toBe(true)

    const sup: Supplier = { id: 'sp1', name: 'NCC cũ', phone: '', address: '', note: '', leadDays: 0, debt: 5000, totalPurchased: 10000, orderCount: 3, createdAt: 1, updatedAt: 1 }
    await dbx.suppliers.put(sup)
    await applyOps([remoteOp('supplier.upsert', { supplier: { id: 'sp1', name: 'NCC mới', phone: '', address: '', note: '', leadDays: 0 } }, hlcString(2500, 0, 'dev_x'))])
    const got = (await dbx.suppliers.get('sp1'))!
    expect(got.name).toBe('NCC mới')
    expect(got.debt).toBe(5000)
    expect(got.totalPurchased).toBe(10000)
    expect(got.orderCount).toBe(3)
  })

  it('user.upsert LWW + user.password + user.delete soft', async () => {
    const hash1 = 'pbkdf2-sha256$2000$' + 'a'.repeat(64)
    const hash2 = 'pbkdf2-sha256$2000$' + 'b'.repeat(64)
    const user: User = {
      id: 'u1', username: 'an', name: 'An', email: '', role: 'staff',
      passwordHash: hash1, salt: 'testsalt1', passwordNeedsReset: true, perms: { sell: true },
      active: true, createdAt: 1, updatedAt: 1,
    }
    await applyOps([remoteOp('user.upsert', { user }, hlcString(2000, 0, 'dev_x'))])
    expect((await dbx.users.get('u1'))!.name).toBe('An')
    await applyOps([remoteOp('user.upsert', { user: { ...user, name: 'cũ hơn' } }, hlcString(1000, 0, 'dev_y'))])
    expect((await dbx.users.get('u1'))!.name).toBe('An')
    await applyOps([remoteOp('user.password', {
      userId: 'u1', passwordHash: hash2, salt: 'testsalt2', passwordNeedsReset: false, updatedAt: 9,
    }, hlcString(3000, 0, 'dev_z'))])
    const afterPw = (await dbx.users.get('u1'))!
    expect(afterPw.passwordHash).toBe(hash2)
    expect(afterPw.salt).toBe('testsalt2')
    expect(afterPw.passwordNeedsReset).toBe(false)
    expect(afterPw.name).toBe('An')
    await applyOps([remoteOp('user.delete', { userId: 'u1' }, hlcString(4000, 0, 'dev_x'))])
    const gone = (await dbx.users.get('u1'))!
    expect(gone.deleted).toBe(true)
    expect(gone.active).toBe(false)
  })

  it('po.upsert LWW + supplier.pay trùng id bỏ qua', async () => {
    const po: PurchaseOrder = {
      id: 'po1', code: 'PO-1', supplierId: 'sp1', supplierName: 'NCC A',
      rows: [{ productId: 'p1', name: 'SP', unit: 'cái', qty: 2, cost: 4000, receivedQty: 0 }],
      total: 8000, status: 'ordered', note: '', date: '2026-08-18', ts: 1,
    }
    await applyOps([remoteOp('po.upsert', po, hlcString(2000, 0, 'dev_x'))])
    expect((await dbx.purchaseOrders.get('po1'))!.status).toBe('ordered')
    await applyOps([remoteOp('po.upsert', { ...po, status: 'cancelled', note: 'cũ' }, hlcString(1000, 0, 'dev_y'))])
    expect((await dbx.purchaseOrders.get('po1'))!.status).toBe('ordered')
    await applyOps([remoteOp('po.upsert', { ...po, status: 'received' }, hlcString(3000, 0, 'dev_z'))])
    expect((await dbx.purchaseOrders.get('po1'))!.status).toBe('received')

    const pay: SupplierPayment = { id: 'spay1', supplierId: 'sp1', amount: 3000, date: '2026-08-18', note: 'trả' }
    await applyOps([remoteOp('supplier.pay', pay)])
    expect(await dbx.supplierPayments.get('spay1')).toBeTruthy()
    await applyOps([remoteOp('supplier.pay', { ...pay, amount: 9999 })])
    expect((await dbx.supplierPayments.get('spay1'))!.amount).toBe(3000)
  })

  it('invoice.upsert LWW + invoice.delete; pricing.upsert LWW + pricing.delete', async () => {
    const inv: InvoiceRecord = {
      id: 'inv1', code: 'HD-1', type: 'import', date: '2026-08-18',
      amount: 10000, tax: 0, status: 'draft', data: {}, ts: 1,
    }
    await applyOps([remoteOp('invoice.upsert', inv, hlcString(2000, 0, 'dev_x'))])
    expect((await dbx.invoices.get('inv1'))!.status).toBe('draft')
    await applyOps([remoteOp('invoice.upsert', { ...inv, status: 'cancelled' }, hlcString(1000, 0, 'dev_y'))])
    expect((await dbx.invoices.get('inv1'))!.status).toBe('draft')
    await applyOps([remoteOp('invoice.delete', { invoiceId: 'inv1' })])
    expect((await dbx.invoices.get('inv1'))!.deleted).toBe(true)

    const rule: PricingRule = { id: 'pr1', name: 'Cafe 40%', cat: 'Cafe', marginPct: 40, roundTo: 1000, active: true }
    await applyOps([remoteOp('pricing.upsert', rule, hlcString(4000, 0, 'dev_x'))])
    expect((await dbx.pricingRules.get('pr1'))!.active).toBe(true)
    await applyOps([remoteOp('pricing.upsert', { ...rule, active: false }, hlcString(3500, 0, 'dev_y'))])
    expect((await dbx.pricingRules.get('pr1'))!.active).toBe(true)
    await applyOps([remoteOp('pricing.delete', { ruleId: 'pr1' })])
    expect((await dbx.pricingRules.get('pr1'))!.deleted).toBe(true)
  })

  it('áp invoice.upsert type gdt từ máy desktop', async () => {
    const inv: InvoiceRecord = {
      id: 'inv_gdt_abc123abc123abc123abcd',
      code: 'C26TAA-9',
      type: 'gdt',
      date: '2026-09-01',
      amount: 100000,
      tax: 10000,
      status: 'issued',
      ts: 1,
      data: {
        invoiceId: 'purchase/normal|invoice|012|1|C26TAA|9',
        nbmst: '012',
        sellerName: 'CTY A',
        source: 'desktop',
        deviceId: 'desk_1',
        hasXml: true,
      },
    }
    await applyOps([remoteOp('invoice.upsert', inv, hlcString(5000, 0, 'desk_1'))])
    const saved = await dbx.invoices.get(inv.id)
    expect(saved?.type).toBe('gdt')
    expect(saved?.data.source).toBe('desktop')
    expect(saved?.data.hasXml).toBe(true)
    expect(saved?.amount).toBe(100000)
  })

  it('dependency thiếu không bị đánh applied hoặc poison và có thể retry sau khi sửa dữ liệu', async () => {
    const sale = mkSale('p-missing', 1)
    const op = remoteOp('sale.commit', sale)

    expect(await applyOps([op])).toBe(0)
    expect(await dbx.appliedOps.get(op.id)).toBeUndefined()
    expect(await dbx.sales.get(sale.id)).toBeUndefined()
    expect((await getPoisonedOps()).find((p) => p.id === op.id)).toBeUndefined()
    expect((await getBlockedOps()).find((p) => p.id === op.id)).toBeTruthy()

    await dbx.products.put(mkProduct({ id: 'p-missing', stock: 5 }))
    expect(await applyOps([op])).toBe(1)
    expect(await dbx.sales.get(sale.id)).toBeTruthy()
    expect((await getBlockedOps()).find((p) => p.id === op.id)).toBeUndefined()
  })

  it('dependency nằm sau trong cùng page được áp rồi retry tự động', async () => {
    const sale = mkSale('p-late', 1, { id: 'sale-before-product' })
    const saleOp = remoteOp('sale.commit', sale)
    const productOp = remoteOp('product.upsert', {
      product: {
        id: 'p-late', name: 'SP đến sau', cat: 'Khác', price: 10000, cost: 6000,
        unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0,
        createdAt: 1, updatedAt: 1,
      },
    })

    expect(await applyOps([saleOp, productOp])).toBe(2)
    expect(await dbx.sales.get(sale.id)).toBeTruthy()
    expect((await dbx.products.get('p-late'))?.stock).toBe(-1)
    expect(await getBlockedOps()).toEqual([])
  })

  it('payload terminal bị quarantine và đánh applied để batch tiếp tục', async () => {
    const bad = remoteOp('sale.commit', { id: 'bad', items: [] })

    await expect(applyOps([bad])).resolves.toBe(0)
    expect(await dbx.appliedOps.get(bad.id)).toBeTruthy()
    expect((await getPoisonedOps()).find((p) => p.id === bad.id)).toBeTruthy()
    expect((await getBlockedOps()).find((p) => p.id === bad.id)).toBeUndefined()
  })
})
