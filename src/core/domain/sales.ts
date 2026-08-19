/**
 * 3SU Next — Nghiệp vụ bán hàng
 * Checkout, giỏ hàng, thanh toán, hủy đơn — port từ 14-sale/14b-checkout/15-orders.
 */
import { dbx, getSettings } from '../db'
import type { Product, ProductBatch, Sale, SaleItem, PayMethod, Customer } from '../types'
import { consumeBatchesFefo, liveBatchExpiry, restoreBatchesFefo } from './inventory'
import { uid, today, localDay } from '../format'
import { enqueueOp, requestFlush } from '../sync/engine'
import { notifyDbChanged, withExclusiveLock } from '../offline'

/* ─── Giỏ hàng (in-memory, persist qua store) ─── */
export interface CartItem {
  productId: string
  qty: number
  unitName: string
  unitRatio: number
}

export function cartUnitPrice(item: CartItem, p: Product, wholesale: boolean): number {
  const base = wholesale && p.wholesalePrice > 0 ? p.wholesalePrice : p.price
  return base * item.unitRatio
}

export function cartUnitCost(item: CartItem, p: Product): number {
  return p.cost * item.unitRatio
}

/** Cộng dồn cùng SP + cùng đơn vị; khác ĐV thì dòng mới. */
export function mergeCartLine(cart: CartItem[], item: CartItem): CartItem[] {
  const i = cart.findIndex((c) => c.productId === item.productId && c.unitName === item.unitName)
  if (i < 0) return [...cart, item]
  return cart.map((c, idx) => (idx === i ? { ...c, qty: c.qty + item.qty } : c))
}

export function setCartLineQty(cart: CartItem[], idx: number, qty: number): CartItem[] {
  if (qty <= 0) return cart.filter((_, i) => i !== idx)
  return cart.map((c, i) => (i === idx ? { ...c, qty } : c))
}

export function removeCartLine(cart: CartItem[], idx: number): CartItem[] {
  return cart.filter((_, i) => i !== idx)
}

export type DiscountKind = 'amount' | 'percent'

/** Đổi giảm giá UI → số tiền đưa vào confirmSale. */
export function discountToAmount(subtotal: number, value: number, kind: DiscountKind): number {
  if (!(subtotal > 0) || !(value > 0)) return 0
  const raw = kind === 'percent' ? subtotal * (value / 100) : value
  return Math.max(0, Math.min(subtotal, Math.round(raw)))
}

/** Cảnh lúc thêm món: hết hàng nếu tồn sau trừ < 0. */
export function stockAddWarning(stock: number, addBaseQty: number): 'out' | null {
  return stock - addBaseQty < 0 ? 'out' : null
}

export { consumeBatchesFefo, restoreBatchesFefo }

async function writeProductBatches(p: Product, batches: ProductBatch[]): Promise<void> {
  p.batches = batches
  p.expiry = liveBatchExpiry(batches) || p.expiry
  await dbx.products.put(p)
  for (const b of batches) await dbx.batches.put(b)
}

export interface CheckoutInput {
  items: CartItem[]
  products: Product[]
  discount: number
  payMethod: PayMethod
  tendered: number
  customerId: string | null
  wholesale: boolean
}

export interface CheckoutResult {
  sale: Sale
  warnings: string[]
}

/**
 * Chốt đơn — atomic transaction:
 * 1. Tính lại giá từ product (không tin tổng client)
 * 2. Trừ tồn kho
 * 3. Ghi đơn + stock moves
 * 4. Cập nhật công nợ khách nếu ghi nợ/thiếu tiền
 */
export async function confirmSale(input: CheckoutInput): Promise<CheckoutResult> {
  if (!input.items.length) throw new Error('Giỏ hàng trống')
  const warnings: string[] = []
  let sale!: Sale

  await withExclusiveLock('sale-commit', () => dbx.transaction('rw', [dbx.products, dbx.sales, dbx.stockMoves, dbx.customers, dbx.batches, dbx.syncQueue, dbx.appliedOps, dbx.meta], async () => {
    const settings = await getSettings()
    const allowNeg = settings.allowNegativeStock !== false
    const saleItems: SaleItem[] = []

    for (const ci of input.items) {
      if (!(ci.qty > 0) || !(ci.unitRatio > 0)) throw new Error('Số lượng không hợp lệ')
      const p = await dbx.products.get(ci.productId)
      if (!p || p.deleted) throw new Error('Sản phẩm không tồn tại: ' + ci.productId)
      const deducted = ci.qty * ci.unitRatio
      if (p.stock - deducted < 0) {
        if (!allowNeg) throw new Error(`${p.name} không đủ tồn (còn ${p.stock})`)
        warnings.push(`${p.name} sẽ âm kho (${p.stock - deducted})`)
      }
      saleItems.push({
        productId: p.id,
        name: p.name,
        qty: ci.qty,
        price: cartUnitPrice(ci, p, input.wholesale),
        cost: cartUnitCost(ci, p),
        unit: ci.unitName || p.unit || 'cái',
        unitRatio: ci.unitRatio,
      })
    }

    const subtotal = saleItems.reduce((a, it) => a + it.price * it.qty, 0)
    const discount = Math.min(input.discount, subtotal)
    const total = Math.max(0, subtotal - discount)
    const profit = saleItems.reduce((a, it) => a + (it.price - it.cost) * it.qty, 0) - discount
    if (profit < 0) warnings.push('Đơn này đang lỗ ' + Math.abs(Math.round(profit)).toLocaleString('vi-VN') + 'đ')

    const isDebt = input.payMethod === 'debt'
    const tendered = isDebt ? 0 : (input.payMethod === 'cash' ? input.tendered : total)
    const change = isDebt ? 0 : Math.max(0, tendered - total)
    const debtAmount = isDebt ? total : (input.payMethod === 'cash' ? Math.max(0, total - tendered) : 0)
    if (debtAmount > 0 && !input.customerId) {
      throw new Error('Chọn khách hàng để ghi nợ phần còn thiếu')
    }
    if (input.customerId) {
      const c = await dbx.customers.get(input.customerId)
      if (!c || c.deleted) throw new Error('Không tìm thấy khách hàng')
    }

    const now = new Date().toISOString()
    sale = {
      id: uid('s'),
      items: saleItems,
      total,
      profit,
      discount,
      payMethod: input.payMethod,
      tendered,
      change,
      debtAmount,
      customerId: input.customerId,
      date: now,
      synced: false,
    }

    for (const it of saleItems) {
      const p = await dbx.products.get(it.productId)
      if (!p) throw new Error('Sản phẩm không tồn tại: ' + it.productId)
      const deducted = it.qty * it.unitRatio
      p.stock -= deducted
      p.updatedAt = Date.now()
      if (p.batches?.length) {
        const { batches } = consumeBatchesFefo(p.batches, deducted)
        await writeProductBatches(p, batches)
      } else {
        await dbx.products.put(p)
      }
      await dbx.stockMoves.add({
        id: uid('mv'),
        productId: p.id,
        type: 'sale',
        qty: -(it.qty * it.unitRatio),
        cost: it.cost,
        note: 'Bán: ' + it.name,
        refId: sale.id,
        date: now,
        ts: Date.now(),
      })
    }

    await dbx.sales.add(sale)

    if (input.customerId) {
      const c = await dbx.customers.get(input.customerId)
      if (!c) throw new Error('Không tìm thấy khách hàng')
      if (debtAmount > 0) c.debt += debtAmount
      c.totalSpent += total
      c.orderCount += 1
      c.updatedAt = Date.now()
      await dbx.customers.put(c)
    }
    await enqueueOp('sale.commit', sale)
  }))
  notifyDbChanged()
  requestFlush()
  return { sale, warnings }
}

/** Hủy đơn — hoàn kho, hoàn nợ */
export async function voidSale(saleId: string, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error('Nhập lý do hủy đơn')
  await dbx.transaction('rw', [dbx.sales, dbx.products, dbx.stockMoves, dbx.customers, dbx.batches, dbx.syncQueue, dbx.appliedOps], async () => {
    const sale = await dbx.sales.get(saleId)
    if (!sale || sale.voided) return

    sale.voided = true
    sale.voidedAt = new Date().toISOString()
    sale.voidReason = reason
    await dbx.sales.put(sale)

    // Hoàn kho
    for (const it of sale.items) {
      const p = await dbx.products.get(it.productId)
      if (!p) throw new Error('Không tìm thấy hàng để hoàn kho: ' + it.name)
      const add = it.qty * it.unitRatio
      p.stock += add
      p.updatedAt = Date.now()
      if (p.batches?.length) {
        await writeProductBatches(p, restoreBatchesFefo(p.batches, add))
      } else {
        await dbx.products.put(p)
      }
      await dbx.stockMoves.add({
        id: uid('mv'),
        productId: it.productId,
        type: 'void_restore',
        qty: it.qty * it.unitRatio,
        cost: it.cost,
        note: 'Hoàn kho do hủy đơn',
        refId: sale.id,
        date: new Date().toISOString(),
        ts: Date.now(),
      })
    }

    // Hoàn nợ
    if (sale.debtAmount > 0 && sale.customerId) {
      const c = await dbx.customers.get(sale.customerId)
      if (c) {
        c.debt = Math.max(0, c.debt - sale.debtAmount)
        c.totalSpent -= sale.total
        c.orderCount = Math.max(0, c.orderCount - 1)
        c.updatedAt = Date.now()
        await dbx.customers.put(c)
      }
    } else if (sale.customerId) {
      const c = await dbx.customers.get(sale.customerId)
      if (c) {
        c.totalSpent -= sale.total
        c.orderCount = Math.max(0, c.orderCount - 1)
        c.updatedAt = Date.now()
        await dbx.customers.put(c)
      }
    }
    await enqueueOp('sale.void', { saleId, reason })
  })
  notifyDbChanged()
  requestFlush()
}

/* ─── Thống kê nhanh ─── */
export function activeSalesFilter(sales: Sale[]): Sale[] {
  return sales.filter((s) => !s.voided)
}

export interface DayStatResult {
  revenue: number
  profit: number
  orders: number
  items: number
}

export function dayStats(sales: Sale[], date: string): DayStatResult {
  const daySales = sales.filter((s) => !s.voided && localDay(s.date) === date)
  return {
    revenue: daySales.reduce((a, s) => a + s.total, 0),
    profit: daySales.reduce((a, s) => a + s.profit, 0),
    orders: daySales.length,
    items: daySales.reduce((a, s) => a + s.items.reduce((x, i) => x + i.qty, 0), 0),
  }
}

export function weekProfitSeries(sales: Sale[], days: number): { date: string; profit: number; revenue: number }[] {
  const result: { date: string; profit: number; revenue: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const ds = localDay(d)
    const st = dayStats(sales, ds)
    result.push({ date: ds, profit: st.profit, revenue: st.revenue })
  }
  return result
}

export function totalDebt(customers: Customer[]): number {
  return customers.filter((c) => !c.deleted).reduce((a, c) => a + Math.max(0, c.debt), 0)
}

/* ─── Sản phẩm bán chạy / tần suất ─── */
export function bestSellerIds(sales: Sale[], limit = 24): string[] {
  const count: Record<string, number> = {}
  activeSalesFilter(sales).slice(-100).forEach((s) =>
    s.items.forEach((it) => {
      count[it.productId] = (count[it.productId] || 0) + it.qty
    }),
  )
  return Object.entries(count)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
}

/* ─── Thói quen khách hàng ─── */
export function customerHabits(sales: Sale[], customerId: string): { productId: string; qty: number }[] {
  const map: Record<string, number> = {}
  sales
    .filter((s) => !s.voided && s.customerId === customerId)
    .forEach((s) => s.items.forEach((it) => { map[it.productId] = (map[it.productId] || 0) + it.qty }))
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([productId, qty]) => ({ productId, qty }))
}

/* ─── Gợi ý đơn vị theo tên sản phẩm (port UNIT_PACKS) ─── */
const UNIT_PACKS: { m: RegExp; u: { n: string; r: number }[] }[] = [
  { m: /mì|phở|bún|cháo|miến/i, u: [{ n: 'gói', r: 1 }, { n: 'thùng', r: 30 }] },
  { m: /coca|pepsi|sting|revive|7up|trà xanh|c2|nước ngọt/i, u: [{ n: 'chai', r: 1 }, { n: 'lốc', r: 6 }, { n: 'thùng', r: 24 }] },
  { m: /la vie|aquafina|vĩnh hảo|dasani|nước suối/i, u: [{ n: 'chai', r: 1 }, { n: 'thùng', r: 24 }] },
  { m: /bia|heineken|tiger|sài gòn|333|saigon/i, u: [{ n: 'lon', r: 1 }, { n: 'lốc', r: 6 }, { n: 'thùng', r: 24 }] },
  { m: /sữa|vinamilk|yomost|milo|th true/i, u: [{ n: 'hộp', r: 1 }, { n: 'lốc', r: 4 }, { n: 'thùng', r: 48 }] },
  { m: /bánh|snack|oishi|poca|lay'?s|cosy|chocopie/i, u: [{ n: 'gói', r: 1 }, { n: 'thùng', r: 20 }] },
  { m: /kẹo|socola/i, u: [{ n: 'gói', r: 1 }, { n: 'hộp', r: 12 }] },
  { m: /thuốc lá|vinataba|marlboro/i, u: [{ n: 'gói', r: 1 }, { n: 'cây', r: 10 }] },
  { m: /gạo/i, u: [{ n: 'kg', r: 1 }, { n: 'bao 5kg', r: 5 }, { n: 'bao 10kg', r: 10 }] },
  { m: /dầu ăn|tường an|neptune|simply/i, u: [{ n: 'chai', r: 1 }, { n: 'thùng', r: 12 }] },
  { m: /nước mắm|nam ngư|chinsu|tương/i, u: [{ n: 'chai', r: 1 }, { n: 'thùng', r: 12 }] },
  { m: /trứng/i, u: [{ n: 'quả', r: 1 }, { n: 'chục', r: 10 }, { n: 'vỉ', r: 30 }] },
]

export function suggestUnits(p: Product): { n: string; r: number }[] {
  const base = { n: p.unit || 'cái', r: 1 }
  if (p.units && p.units.length) return [base, ...p.units]
  const hay = (p.name || '') + ' ' + (p.cat || '')
  for (const pack of UNIT_PACKS) {
    if (pack.m.test(hay)) return pack.u
  }
  return [base]
}

/** Mệnh giá tiền mặt gợi ý */
export const DENOMINATIONS = [10000, 20000, 50000, 100000, 200000, 500000]
