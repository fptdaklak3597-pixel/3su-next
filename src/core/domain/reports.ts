/**
 * 3SU Next — Nghiệp vụ báo cáo
 * Báo cáo được dựng từ fact theo dòng để mọi bộ lọc, giảm giá, đơn vị và payment
 * cùng dùng một nguồn tính toán có thể đối soát về tổng chứng từ.
 */
import type { Sale, Product, Customer, SaleItem } from '../types'
import { localDay, daysAgo, today } from '../format'

export type ReportPreset = '7' | '30' | 'mtd' | 'ytd' | 'all' | 'custom'
export type ReportMetric = 'profit' | 'revenue'

export interface ReportFilters {
  preset: ReportPreset
  from: string
  to: string
  metric: ReportMetric
  cat: string
  pay: string
  customerId: string | null
  compare: boolean
}

export interface ReportResult {
  from: string
  to: string
  revenue: number
  profit: number
  orders: number
  items: number
  avgOrder: number
  daily: { date: string; revenue: number; profit: number; orders: number }[]
  topProducts: { productId: string; name: string; qty: number; revenue: number; profit: number }[]
  topCategories: { cat: string; revenue: number; profit: number }[]
  payBreakdown: { method: string; count: number; amount: number }[]
  prev?: { revenue: number; profit: number; orders: number }
}

interface ReportFact {
  saleId: string
  date: string
  productId: string
  name: string
  cat: string
  baseQty: number
  grossRevenue: number
  allocatedDiscount: number
  revenue: number
  cost: number
  profit: number
}

interface PaymentParts {
  cash: number
  transfer: number
  debt: number
}

const PAY_LABELS: Record<keyof PaymentParts, string> = {
  cash: 'Tiền mặt',
  transfer: 'Chuyển khoản',
  debt: 'Ghi nợ',
}

function money(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
}

function positive(value: unknown, fallback = 0): number {
  return Math.max(0, money(value, fallback))
}

/** Phân bổ số tiền nguyên, tổng các phần luôn bằng target. */
function allocateNonNegative(targetValue: number, rawWeights: number[]): number[] {
  if (!rawWeights.length) return []
  const target = Math.max(0, Math.round(targetValue))
  const weights = rawWeights.map((value) => Number.isFinite(value) ? Math.max(0, value) : 0)
  const totalWeight = weights.reduce((sum, value) => sum + value, 0)
  let remaining = target
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return remaining
    const share = totalWeight > 0 ? Math.floor(target * weight / totalWeight) : 0
    const safeShare = Math.min(remaining, Math.max(0, share))
    remaining -= safeShare
    return safeShare
  })
}

export function resolveRange(f: ReportFilters): { from: string; to: string } {
  const t = today()
  if (f.preset === 'custom' && f.from && f.to) return { from: f.from, to: f.to }
  if (f.preset === 'mtd') return { from: today().slice(0, 8) + '01', to: t }
  if (f.preset === 'ytd') return { from: new Date().getFullYear() + '-01-01', to: t }
  if (f.preset === 'all') return { from: '1970-01-01', to: t }
  const n = Number(f.preset) || 7
  return { from: daysAgo(n - 1), to: t }
}

function prevRange(from: string, to: string): { from: string; to: string } {
  const d1 = new Date(from + 'T00:00:00')
  const d2 = new Date(to + 'T00:00:00')
  const days = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1)
  const pd2 = new Date(d1)
  pd2.setDate(pd2.getDate() - 1)
  const pd1 = new Date(pd2)
  pd1.setDate(pd1.getDate() - (days - 1))
  return { from: localDay(pd1), to: localDay(pd2) }
}

function paymentParts(sale: Sale): PaymentParts {
  const total = positive(sale.total)
  const debt = sale.payMethod === 'debt'
    ? total
    : Math.min(total, positive(sale.debtAmount))
  const paid = Math.max(0, total - debt)
  return {
    cash: sale.payMethod === 'cash' ? paid : 0,
    transfer: sale.payMethod === 'transfer' ? paid : 0,
    debt,
  }
}

function hasPayment(sale: Sale, method: string): boolean {
  if (!method || method === 'all') return true
  if (method !== 'cash' && method !== 'transfer' && method !== 'debt') return false
  return paymentParts(sale)[method] > 0
}

function factForMissingItems(sale: Sale): ReportFact {
  return {
    saleId: sale.id,
    date: localDay(sale.date),
    productId: '',
    name: 'Không rõ mặt hàng',
    cat: 'Khác',
    baseQty: 0,
    grossRevenue: positive(sale.total) + positive(sale.discount),
    allocatedDiscount: positive(sale.discount),
    revenue: positive(sale.total),
    cost: Math.max(0, positive(sale.total) - money(sale.profit)),
    profit: money(sale.profit),
  }
}

/**
 * Phân bổ discount theo doanh thu gộp của từng dòng, sau đó hiệu chỉnh dòng cuối
 * để tổng revenue/profit bằng đúng chứng từ đã lưu (hỗ trợ cả dữ liệu legacy).
 */
function factsForSale(sale: Sale, productById: Map<string, Product>): ReportFact[] {
  if (!Array.isArray(sale.items) || sale.items.length === 0) return [factForMissingItems(sale)]

  const rows = sale.items.map((item: SaleItem) => {
    const qty = typeof item.qty === 'number' && Number.isFinite(item.qty) ? Math.max(0, item.qty) : 0
    const ratio = typeof item.unitRatio === 'number' && Number.isFinite(item.unitRatio) && item.unitRatio > 0
      ? item.unitRatio
      : 1
    const gross = Math.max(0, money(item.price) * qty)
    const cost = Math.max(0, money(item.cost) * qty)
    const product = productById.get(item.productId)
    return {
      item,
      qty,
      ratio,
      gross,
      cost,
      cat: product?.cat || 'Khác',
      name: product?.name || item.name || '—',
    }
  })

  const grossTotal = rows.reduce((sum, row) => sum + row.gross, 0)
  const discountTarget = Math.min(grossTotal, positive(sale.discount))
  const discountShares = allocateNonNegative(discountTarget, rows.map((row) => row.gross))
  const facts = rows.map((row, index): ReportFact => {
    const allocatedDiscount = discountShares[index] ?? 0
    const revenue = row.gross - allocatedDiscount
    return {
      saleId: sale.id,
      date: localDay(sale.date),
      productId: row.item.productId,
      name: row.name,
      cat: row.cat,
      baseQty: row.qty * row.ratio,
      grossRevenue: row.gross,
      allocatedDiscount,
      revenue,
      cost: row.cost,
      profit: revenue - row.cost,
    }
  })

  const last = facts[facts.length - 1]
  if (last) {
    const revenueCorrection = positive(sale.total) - facts.reduce((sum, fact) => sum + fact.revenue, 0)
    const profitCorrection = money(sale.profit) - facts.reduce((sum, fact) => sum + fact.profit, 0)
    last.revenue += revenueCorrection
    last.profit += profitCorrection
  }
  return facts
}

function selectFacts(
  sales: Sale[],
  productById: Map<string, Product>,
  f: ReportFilters,
  from: string,
  to: string,
): { facts: ReportFact[]; saleById: Map<string, Sale> } {
  const saleById = new Map<string, Sale>()
  const facts: ReportFact[] = []
  const allCategories = !f.cat || f.cat === 'all'

  for (const sale of sales) {
    if (sale.voided) continue
    const date = localDay(sale.date)
    if (date < from || date > to) continue
    if (f.customerId && sale.customerId !== f.customerId) continue
    if (!hasPayment(sale, f.pay)) continue

    const saleFacts = factsForSale(sale, productById)
      .filter((fact) => allCategories || fact.cat === f.cat)
    if (!saleFacts.length) continue
    saleById.set(sale.id, sale)
    facts.push(...saleFacts)
  }
  return { facts, saleById }
}

function summarizeFacts(
  facts: ReportFact[],
  saleById: Map<string, Sale>,
): Omit<ReportResult, 'from' | 'to' | 'prev'> {
  const revenue = facts.reduce((sum, fact) => sum + fact.revenue, 0)
  const profit = facts.reduce((sum, fact) => sum + fact.profit, 0)
  const items = facts.reduce((sum, fact) => sum + fact.baseQty, 0)
  const orders = saleById.size

  const dailyMap = new Map<string, {
    revenue: number
    profit: number
    saleIds: Set<string>
  }>()
  for (const fact of facts) {
    const row = dailyMap.get(fact.date) ?? { revenue: 0, profit: 0, saleIds: new Set<string>() }
    row.revenue += fact.revenue
    row.profit += fact.profit
    row.saleIds.add(fact.saleId)
    dailyMap.set(fact.date, row)
  }
  const daily = [...dailyMap.entries()]
    .map(([date, value]) => ({
      date,
      revenue: value.revenue,
      profit: value.profit,
      orders: value.saleIds.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const productMap = new Map<string, {
    name: string
    qty: number
    revenue: number
    profit: number
  }>()
  for (const fact of facts) {
    if (!fact.productId) continue
    const row = productMap.get(fact.productId) ?? { name: fact.name, qty: 0, revenue: 0, profit: 0 }
    row.qty += fact.baseQty
    row.revenue += fact.revenue
    row.profit += fact.profit
    productMap.set(fact.productId, row)
  }
  const topProducts = [...productMap.entries()]
    .map(([productId, value]) => ({ productId, ...value }))
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
    .slice(0, 15)

  const categoryMap = new Map<string, { revenue: number; profit: number }>()
  for (const fact of facts) {
    const row = categoryMap.get(fact.cat) ?? { revenue: 0, profit: 0 }
    row.revenue += fact.revenue
    row.profit += fact.profit
    categoryMap.set(fact.cat, row)
  }
  const topCategories = [...categoryMap.entries()]
    .map(([cat, value]) => ({ cat, ...value }))
    .sort((a, b) => b.revenue - a.revenue)

  const factsBySale = new Map<string, ReportFact[]>()
  for (const fact of facts) {
    const rows = factsBySale.get(fact.saleId) ?? []
    rows.push(fact)
    factsBySale.set(fact.saleId, rows)
  }
  const payMap: Record<keyof PaymentParts, { amount: number; saleIds: Set<string> }> = {
    cash: { amount: 0, saleIds: new Set<string>() },
    transfer: { amount: 0, saleIds: new Set<string>() },
    debt: { amount: 0, saleIds: new Set<string>() },
  }
  for (const [saleId, saleFacts] of factsBySale) {
    const sale = saleById.get(saleId)
    if (!sale) continue
    const selectedRevenue = Math.max(0, saleFacts.reduce((sum, fact) => sum + fact.revenue, 0))
    const parts = paymentParts(sale)
    const methods: (keyof PaymentParts)[] = ['cash', 'transfer', 'debt']
    const allocated = allocateNonNegative(selectedRevenue, methods.map((method) => parts[method]))
    methods.forEach((method, index) => {
      const amount = allocated[index] ?? 0
      if (amount <= 0) return
      payMap[method].amount += amount
      payMap[method].saleIds.add(saleId)
    })
  }
  const payBreakdown = (Object.keys(payMap) as (keyof PaymentParts)[])
    .filter((method) => payMap[method].amount > 0)
    .map((method) => ({
      method: PAY_LABELS[method],
      count: payMap[method].saleIds.size,
      amount: payMap[method].amount,
    }))

  return {
    revenue,
    profit,
    orders,
    items,
    avgOrder: orders > 0 ? Math.round(revenue / orders) : 0,
    daily,
    topProducts,
    topCategories,
    payBreakdown,
  }
}

export function buildReport(sales: Sale[], products: Product[], f: ReportFilters): ReportResult {
  const { from, to } = resolveRange(f)
  const productById = new Map(products.map((product) => [product.id, product]))
  const currentSelection = selectFacts(sales, productById, f, from, to)
  const current = summarizeFacts(currentSelection.facts, currentSelection.saleById)

  let prev: ReportResult['prev']
  if (f.compare) {
    const range = prevRange(from, to)
    const previousSelection = selectFacts(sales, productById, f, range.from, range.to)
    const previous = summarizeFacts(previousSelection.facts, previousSelection.saleById)
    prev = {
      revenue: previous.revenue,
      profit: previous.profit,
      orders: previous.orders,
    }
  }

  return { from, to, ...current, prev }
}

/** Bảng Excel kỳ báo cáo (AOA). */
export function reportToAoa(report: ReportResult): unknown[][] {
  return [
    ['Từ', report.from, 'Đến', report.to],
    ['Doanh thu', report.revenue, 'Lợi nhuận', report.profit, 'Đơn', report.orders],
    [],
    ['Ngày', 'Doanh thu', 'Lợi nhuận', 'Đơn'],
    ...report.daily.map((d) => [d.date, d.revenue, d.profit, d.orders]),
    [],
    ['Sản phẩm', 'SL gốc', 'Doanh thu', 'Lợi nhuận'],
    ...report.topProducts.map((p) => [p.name, p.qty, p.revenue, p.profit]),
  ]
}

export async function exportReportXlsx(report: ReportResult): Promise<void> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(reportToAoa(report))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Bao cao')
  XLSX.writeFile(wb, `3su-bao-cao-${report.from}-${report.to}.xlsx`)
}

/** Tổng nợ khách hàng */
export function customerDebtSummary(customers: Customer[]): { totalDebt: number; debtors: number } {
  const active = customers.filter((c) => !c.deleted && c.debt > 0)
  return {
    totalDebt: active.reduce((a, c) => a + c.debt, 0),
    debtors: active.length,
  }
}
