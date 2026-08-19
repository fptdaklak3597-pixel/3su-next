/**
 * 3SU Next — Nghiệp vụ kho hàng
 * Sản phẩm, nhập kho (giá vốn bình quân gia quyền), kiểm kê, dự báo.
 * Port từ 16-inventory, 20-goods-receipt, 16b-stocktake, 28-stock-forecast.
 */
import { dbx } from '../db'
import type {
  Product, GoodsReceipt, GoodsReceiptRow, StocktakeRecord, StockForecast, Sale,
  ProductBatch, PriceLogEntry, GrPatch, GrCommitPayload, PayMethod,
} from '../types'
import { uid, localDay, daysToExpiry } from '../format'
import { makeOp, persistOp, requestFlush } from '../sync/engine'

/* ─── Sản phẩm ─── */
export async function addProduct(input: {
  name: string
  cat: string
  price: number
  cost: number
  stock: number
  unit: string
  barcode?: string
  expiry?: string
  wholesalePrice?: number
  units?: Product['units']
}): Promise<Product> {
  const now = Date.now()
  const p: Product = {
    id: uid('p'),
    name: input.name.trim(),
    cat: input.cat.trim(),
    price: input.price,
    cost: input.cost,
    stock: input.stock,
    unit: input.unit || 'cái',
    barcode: input.barcode?.trim() || '',
    expiry: input.expiry || '',
    units: input.units ?? [],
    wholesalePrice: input.wholesalePrice || 0,
    batches: [],
    createdAt: now,
    updatedAt: now,
  }
  await dbx.transaction('rw', [dbx.products, dbx.stockMoves, dbx.syncQueue, dbx.appliedOps], async () => {
    const upsertOp = makeOp('product.upsert', null)
    p.hlc = upsertOp.hlc
    await dbx.products.add(p)
    const { stock: _s, batches: _b, ...rest } = p
    upsertOp.payload = { product: rest }
    await persistOp(upsertOp)
    if (p.stock > 0) {
      const adjustOp = makeOp('stock.adjust', { productId: p.id, delta: p.stock, reason: 'init' })
      await dbx.stockMoves.add({
        id: 'mv_' + adjustOp.id,
        productId: p.id,
        type: 'adjust',
        qty: p.stock,
        cost: p.cost,
        note: 'Tồn kho ban đầu',
        refId: p.id,
        date: new Date().toISOString(),
        ts: now,
      })
      await persistOp(adjustOp)
    }
  })
  requestFlush()
  return p
}

export async function updateProduct(id: string, patch: Partial<Product>): Promise<void> {
  const p = await dbx.products.get(id)
  if (!p) return
  const { stock: newStock, ...restPatch } = patch
  const stockChanged = typeof newStock === 'number' && newStock !== p.stock
  await dbx.transaction('rw', [dbx.products, dbx.stockMoves, dbx.batches, dbx.syncQueue, dbx.appliedOps], async () => {
    const upsertOp = makeOp('product.upsert', null)
    const updated: Product = {
      ...p, ...restPatch,
      stock: stockChanged ? (newStock as number) : p.stock,
      id, updatedAt: Date.now(), hlc: upsertOp.hlc,
    }
    if (stockChanged) {
      const delta = (newStock as number) - p.stock
      await applyStockDeltaToBatches(updated, delta)
    }
    const omit = new Set(['id', 'stock', 'batches', 'stockSetHlc', 'grHlc', 'fieldHlc'])
    const product: Record<string, unknown> = { id }
    const fieldHlc = { ...(p.fieldHlc ?? {}) }
    for (const key of Object.keys(updated) as (keyof Product)[]) {
      if (omit.has(key)) continue
      if (!Object.is(updated[key], p[key])) {
        product[key] = updated[key]
        fieldHlc[key] = upsertOp.hlc
      }
    }
    updated.fieldHlc = fieldHlc
    await dbx.products.put(updated)
    upsertOp.payload = { product }
    await persistOp(upsertOp)
    if (stockChanged) {
      const delta = (newStock as number) - p.stock
      const adjustOp = makeOp('stock.adjust', { productId: id, delta, reason: 'edit' })
      await dbx.stockMoves.add({
        id: 'mv_' + adjustOp.id, productId: p.id, type: 'adjust', qty: delta, cost: p.cost,
        note: 'Điều chỉnh tồn (sửa SP)', refId: p.id, date: new Date().toISOString(), ts: Date.now(),
      })
      await persistOp(adjustOp)
    }
  })
  requestFlush()
}

export async function deleteProduct(id: string): Promise<void> {
  const p = await dbx.products.get(id)
  if (!p) return
  await dbx.transaction('rw', [dbx.products, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('product.delete', { productId: id })
    await dbx.products.put({ ...p, deleted: true, deletedHlc: op.hlc, hlc: op.hlc, updatedAt: Date.now() })
    await persistOp(op)
  })
  requestFlush()
}

export function lowStockItems(products: Product[], threshold: number): Product[] {
  return products.filter((p) => !p.deleted && p.stock > 0 && p.stock <= threshold)
}

export function outOfStockItems(products: Product[]): Product[] {
  return products.filter((p) => !p.deleted && p.stock <= 0)
}

export function inventoryValue(products: Product[]): number {
  return products.filter((p) => !p.deleted).reduce((a, p) => a + p.stock * p.cost, 0)
}

export function productCategories(products: Product[]): string[] {
  const cats = new Set<string>()
  products.filter((p) => !p.deleted && p.cat).forEach((p) => cats.add(p.cat))
  return [...cats].sort((a, b) => a.localeCompare(b, 'vi'))
}

/* ─── Phân tích kho (port analyzeInventory) ─── */
export interface InventoryAnalysis {
  low: Product[]
  out: Product[]
  nearExpiry: Product[]
  expired: Product[]
  noExpiry: Product[]
  totalValue: number
  topByValue: { cat: string; value: number }[]
}

export function analyzeInventory(products: Product[], lowStock: number, warnDays: number): InventoryAnalysis {
  const active = products.filter((p) => !p.deleted)
  const nearExpiry = active
    .filter((p) => {
      const n = daysToExpiry(p.expiry)
      return n !== null && n >= 0 && n <= (warnDays * 2)
    })
    .sort((a, b) => (daysToExpiry(a.expiry) ?? 999) - (daysToExpiry(b.expiry) ?? 999))

  const catVal: Record<string, number> = {}
  active.forEach((p) => { catVal[p.cat || 'Khác'] = (catVal[p.cat || 'Khác'] || 0) + p.price * p.stock })

  return {
    low: lowStockItems(products, lowStock),
    out: outOfStockItems(products),
    nearExpiry,
    expired: active.filter((p) => { const n = daysToExpiry(p.expiry); return n !== null && n < 0 }),
    noExpiry: active.filter((p) => !p.expiry),
    totalValue: inventoryValue(products),
    topByValue: Object.entries(catVal).map(([cat, value]) => ({ cat, value })).sort((a, b) => b.value - a.value),
  }
}

/* ─── Nhập kho (Goods Receipt) — giá vốn bình quân gia quyền + FEFO lô ─── */
export type GoodsReceiptInput = {
  supplier: string
  supplierId?: string
  purchaseOrderId?: string
  date: string
  expiry: string
  note: string
  rows: GoodsReceiptRow[]
  paid?: number
  payMethod?: PayMethod
  /** Giá bán mới theo dòng (cập nhật retail price) */
  prices?: Record<string, number>
}

export interface NormalizedReceiptPayment {
  paid: number
  payMethod?: PayMethod
  outstanding: number
}

/**
 * Chuẩn hóa thanh toán phiếu nhập.
 * - Ghi nợ luôn có paid=0.
 * - Với tiền mặt/chuyển khoản, paid=0 nghĩa là chưa trả và toàn bộ còn nợ.
 * - Không cho trả vượt phiếu; khoản ứng trước NCC được ghi bằng supplier payment riêng.
 */
export function normalizeReceiptPayment(
  total: number,
  paid: number | undefined,
  payMethod: PayMethod | undefined,
): NormalizedReceiptPayment {
  if (!Number.isFinite(total) || total < 0) throw new Error('Tổng tiền nhập không hợp lệ')
  if (payMethod !== undefined && !['cash', 'transfer', 'debt'].includes(payMethod)) {
    throw new Error('Hình thức thanh toán không hợp lệ')
  }
  const rawPaid = paid ?? 0
  if (!Number.isFinite(rawPaid) || rawPaid < 0) throw new Error('Số tiền đã trả không hợp lệ')
  let normalized = Math.round(rawPaid)
  const roundedTotal = Math.round(total)
  if (payMethod === 'debt') normalized = 0
  if (normalized > roundedTotal) throw new Error('Số tiền đã trả vượt tổng phiếu nhập')
  return {
    paid: normalized,
    payMethod,
    outstanding: Math.max(0, roundedTotal - normalized),
  }
}

function normalizeReceiptRows(rows: GoodsReceiptRow[]): GoodsReceiptRow[] {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Phiếu nhập cần ít nhất một mặt hàng')
  return rows.map((row) => {
    if (!row?.productId) throw new Error('Dòng nhập thiếu sản phẩm')
    if (!Number.isFinite(row.qty) || row.qty <= 0) throw new Error(`Số lượng nhập không hợp lệ: ${row.name || row.productId}`)
    if (!Number.isFinite(row.cost) || row.cost < 0) throw new Error(`Giá nhập không hợp lệ: ${row.name || row.productId}`)
    const unitRatio = row.unitRatio ?? 1
    if (!Number.isFinite(unitRatio) || unitRatio <= 0) throw new Error(`Quy đổi đơn vị không hợp lệ: ${row.name || row.productId}`)
    return {
      ...row,
      name: String(row.name || '').trim() || row.productId,
      unit: String(row.unit || '').trim() || 'cái',
      unitRatio,
      cost: Math.round(row.cost),
      expiry: String(row.expiry || ''),
    }
  })
}

/** Gọi bên trong transaction Dexie đã mở. Không requestFlush. */
export async function applyGoodsReceiptInTx(input: GoodsReceiptInput): Promise<GoodsReceipt> {
  const rows = normalizeReceiptRows(input.rows)
  for (const r of rows) {
    const p = await dbx.products.get(r.productId)
    if (!p || p.deleted) throw new Error('Không tìm thấy hàng: ' + (r.name || r.productId))
    if (!Number.isFinite(p.stock) || !Number.isFinite(p.cost)) throw new Error('Dữ liệu tồn kho không hợp lệ: ' + p.name)
  }
  const code = 'NK-' + input.date.replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 900) + 100)
  const total = Math.round(rows.reduce((a, r) => a + r.qty * r.cost, 0))
  const payment = normalizeReceiptPayment(total, input.paid, input.payMethod)
  const gr: GoodsReceipt = {
    id: uid('gr'),
    code,
    supplier: String(input.supplier || '').trim() || 'NCC lẻ',
    supplierId: input.supplierId,
    purchaseOrderId: input.purchaseOrderId,
    date: input.date,
    expiry: input.expiry,
    note: input.note,
    rows,
    total,
    paid: payment.paid,
    payMethod: payment.payMethod,
    ts: Date.now(),
  }

  const grOp = makeOp('gr.commit', null)
  const patches: GrPatch[] = []
  for (const r of rows) {
    const p = await dbx.products.get(r.productId)
    if (!p) throw new Error('Không tìm thấy hàng: ' + (r.name || r.productId))

    const unitRatio = r.unitRatio
    const addQty = r.qty * unitRatio
    if (!Number.isFinite(addQty) || addQty <= 0) throw new Error('Số lượng quy đổi không hợp lệ: ' + r.name)
    const oldStock = p.stock
    const oldCost = p.cost
    const newStock = oldStock + addQty
    const costBase = r.cost / unitRatio

    if (oldStock <= 0) {
      p.cost = Math.round(costBase || r.cost || oldCost || 0)
    } else if (newStock > 0) {
      p.cost = Math.round((oldStock * oldCost + r.qty * r.cost) / newStock)
    }

    p.stock = newStock

    const rowExp = r.expiry || input.expiry
    if (rowExp) {
      const cur = daysToExpiry(p.expiry)
      const nw = daysToExpiry(rowExp)
      if (!p.expiry || (nw !== null && cur !== null && nw < cur)) p.expiry = rowExp
    }

    const newPrice = input.prices?.[r.productId]
    if (newPrice !== undefined && (!Number.isFinite(newPrice) || newPrice < 0)) {
      throw new Error('Giá bán mới không hợp lệ: ' + p.name)
    }
    if (newPrice && newPrice > 0) p.price = Math.round(newPrice)

    p.grHlc = grOp.hlc
    p.updatedAt = Date.now()
    await dbx.products.put(p)

    const patch: GrPatch = {
      productId: p.id,
      addQty,
      newCost: p.cost,
      newPrice: newPrice && newPrice > 0 ? Math.round(newPrice) : undefined,
      expiry: rowExp || undefined,
      batches: [],
      priceLogRows: [],
    }

    if (rowExp) {
      const batch: ProductBatch = {
        id: uid('bt'),
        qty: addQty,
        remain: addQty,
        cost: Math.round(costBase || r.cost),
        expiry: rowExp,
        date: input.date,
        supId: input.supplierId || '',
        supName: gr.supplier,
      }
      await dbx.batches.add(batch)
      p.batches = [...(p.batches || []), batch]
      await dbx.products.put(p)
      patch.batches.push(batch)
    }

    const plRow: PriceLogEntry = {
      id: uid('pl'),
      productId: r.productId,
      supId: input.supplierId || '',
      supName: gr.supplier,
      cost: r.cost,
      ts: Date.now(),
    }
    await dbx.priceLog.add(plRow)
    patch.priceLogRows.push(plRow)

    await dbx.stockMoves.add({
      id: uid('mv'),
      productId: p.id,
      type: 'purchase',
      qty: addQty,
      cost: Math.round(costBase || r.cost),
      note: 'NK ' + code,
      refId: gr.id,
      date: new Date(input.date + 'T12:00:00').toISOString(),
      ts: Date.now(),
    })

    patches.push(patch)
  }
  await dbx.goodsReceipts.add(gr)

  let supplierDelta: GrCommitPayload['supplierDelta']
  if (input.supplierId) {
    const sup = await dbx.suppliers.get(input.supplierId)
    // Backup/PO legacy có thể còn supplierId nhưng thiếu hồ sơ NCC. Vẫn giữ liên kết
    // trên phiếu để đối soát; chỉ bỏ cập nhật projection hồ sơ bị thiếu.
    if (sup && !sup.deleted) {
      sup.totalPurchased = (Number.isFinite(sup.totalPurchased) ? sup.totalPurchased : 0) + total
      sup.orderCount = (Number.isFinite(sup.orderCount) ? sup.orderCount : 0) + 1
      sup.updatedAt = Date.now()
      await dbx.suppliers.put(sup)
      supplierDelta = {
        supplierId: input.supplierId,
        debtDelta: 0,
        purchasedDelta: total,
      }
    }
  }

  grOp.payload = { gr, patches, supplierDelta }
  await persistOp(grOp)
  return gr
}

export async function saveGoodsReceipt(input: GoodsReceiptInput): Promise<GoodsReceipt> {
  let gr!: GoodsReceipt
  await dbx.transaction('rw', [dbx.products, dbx.goodsReceipts, dbx.stockMoves, dbx.suppliers, dbx.supplierPayments, dbx.batches, dbx.priceLog, dbx.syncQueue, dbx.appliedOps], async () => {
    gr = await applyGoodsReceiptInTx(input)
  })
  requestFlush()
  return gr
}

/** HSD sớm nhất trong các lô còn hàng (port liveBatchExpiry). */
export function liveBatchExpiry(batches: ProductBatch[]): string {
  const remaining = (batches || []).filter((b) => b.remain > 0 && b.expiry)
  if (remaining.length === 0) return ''
  return remaining.map((b) => b.expiry).sort()[0]
}

/** Trừ lô FEFO — HSD sớm trước. leftover = phần không có lô. */
export function consumeBatchesFefo(batches: ProductBatch[], qty: number): { batches: ProductBatch[]; leftover: number } {
  const next = batches.map((b) => ({ ...b }))
  let left = Math.max(0, qty)
  const order = [...next].sort((a, b) => {
    const ea = a.expiry || '9999-12-31'
    const eb = b.expiry || '9999-12-31'
    return ea.localeCompare(eb) || String(a.date).localeCompare(String(b.date))
  })
  for (const b of order) {
    if (left <= 0) break
    const take = Math.min(Math.max(0, b.remain), left)
    b.remain -= take
    left -= take
  }
  return { batches: next, leftover: left }
}

/**
 * Điều chỉnh lô theo delta tồn (kiểm kê / sửa SP).
 * delta < 0: trừ FEFO; delta > 0: thêm lô «Kiểm kê». leftover FEFO không chặn — tồn vẫn theo actual.
 */
export async function applyStockDeltaToBatches(p: Product, delta: number): Promise<ProductBatch[]> {
  if (delta === 0) return p.batches || []
  let next: ProductBatch[]
  if (delta < 0) {
    next = consumeBatchesFefo(p.batches || [], -delta).batches
  } else {
    next = [...(p.batches || [])]
    next.push({
      id: uid('bt'),
      qty: delta,
      remain: delta,
      cost: p.cost,
      expiry: '',
      date: localDay(new Date()),
      supName: 'Kiểm kê',
    })
  }
  p.batches = next
  p.expiry = liveBatchExpiry(next)
  for (const b of next) await dbx.batches.put(b)
  return next
}

/** Hoàn lô khi hủy đơn — cộng remain vào chỗ đã trừ (qty - remain). */
export function restoreBatchesFefo(batches: ProductBatch[], qty: number): ProductBatch[] {
  const next = batches.map((b) => ({ ...b }))
  let left = Math.max(0, qty)
  const order = [...next].sort((a, b) => {
    const ea = a.expiry || '9999-12-31'
    const eb = b.expiry || '9999-12-31'
    return ea.localeCompare(eb)
  })
  for (const b of order) {
    if (left <= 0) break
    const room = Math.max(0, (b.qty || 0) - b.remain)
    const add = Math.min(room, left)
    b.remain += add
    left -= add
  }
  return next
}

/** Phát hiện giá nhập tăng đột biến so với TB 5 lần gần nhất (port priceSpike). */
export function detectPriceSpike(history: PriceLogEntry[], cost: number): number | null {
  const recs = history.slice(-5)
  if (recs.length < 2) return null
  const avg = recs.reduce((a, b) => a + b.cost, 0) / recs.length
  if (cost > avg * 1.15) return Math.round(((cost - avg) / avg) * 100)
  return null
}

/** Vốn nhập gần nhất từ nhật ký giá. */
export function lastPurchaseCost(logs: PriceLogEntry[], productId: string): number | null {
  const last = logs.filter((l) => l.productId === productId).sort((a, b) => b.ts - a.ts)[0]
  return last ? last.cost : null
}

/** Gợi ý giá bán khi nhập kho (port purchaseAdviceHtml): margin 15–30% */
export function suggestSellPrice(cost: number, currentPrice: number): { price: number; margin: number } | null {
  if (cost <= 0) return null
  const suggested = Math.round((cost * 1.2) / 100) * 100 // margin 20%
  if (currentPrice > 0 && currentPrice >= cost * 1.1) return null // giá hiện tại đã ổn
  return { price: suggested, margin: Math.round(((suggested - cost) / cost) * 100) }
}

/* ─── Kiểm kê ─── */
/** Dòng lệch, hoặc dòng người bán đã đếm (kể cả thực tế = sổ). */
export function selectStocktakeRows<T extends { productId: string; system: number; actual: number }>(
  rows: T[],
  touchedIds: ReadonlySet<string>,
): T[] {
  return rows.filter((r) => r.actual !== r.system || touchedIds.has(r.productId))
}

export async function saveStocktake(rows: { productId: string; name: string; system: number; actual: number }[], note: string): Promise<StocktakeRecord> {
  const record: StocktakeRecord = {
    id: uid('st'),
    date: new Date().toISOString(),
    rows: rows.map((r) => ({ ...r, diff: r.actual - r.system })),
    note,
    ts: Date.now(),
  }

  await dbx.transaction('rw', [dbx.products, dbx.stocktakes, dbx.stockMoves, dbx.batches, dbx.syncQueue, dbx.appliedOps], async () => {
    const stOp = makeOp('stocktake.commit', record)
    for (const r of record.rows) {
      if (r.diff === 0) continue
      const p = await dbx.products.get(r.productId)
      if (!p) continue
      p.stock = r.actual
      await applyStockDeltaToBatches(p, r.diff)
      p.stockSetHlc = stOp.hlc
      p.updatedAt = Date.now()
      await dbx.products.put(p)
      await dbx.stockMoves.add({
        id: uid('mv'),
        productId: r.productId,
        type: 'stocktake',
        qty: r.diff,
        cost: p.cost,
        note: 'Kiểm kê: ' + (r.diff > 0 ? 'thừa' : 'thiếu') + ' ' + Math.abs(r.diff),
        refId: record.id,
        date: record.date,
        ts: Date.now(),
      })
    }
    await dbx.stocktakes.add(record)
    await persistOp(stOp)
  })
  requestFlush()
  return record
}

/* ─── Dự báo tồn kho (port 28-stock-forecast) ─── */
export function forecastStock(products: Product[], sales: Sale[], days = 30): StockForecast[] {
  const soldMap: Record<string, number> = {}
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)

  sales
    .filter((s) => !s.voided && new Date(s.date) >= cutoff)
    .forEach((s) => s.items.forEach((it) => {
      soldMap[it.productId] = (soldMap[it.productId] || 0) + it.qty * it.unitRatio
    }))

  return products
    .filter((p) => !p.deleted)
    .map((p) => {
      const sold = soldMap[p.id] || 0
      const avgPerDay = sold / days
      const daysLeft = avgPerDay > 0 ? Math.floor(p.stock / avgPerDay) : Infinity
      const suggestedQty = avgPerDay > 0 ? Math.max(0, Math.ceil(avgPerDay * 14 - p.stock)) : 0
      return { productId: p.id, name: p.name, avgPerDay, daysLeft, suggestedQty }
    })
    .filter((f) => f.avgPerDay > 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)
}

export function forecastAlertCount(products: Product[], sales: Sale[]): number {
  return forecastStock(products, sales).filter((f) => f.daysLeft <= 7).length
}
