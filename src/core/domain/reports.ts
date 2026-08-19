/**
 * 3SU Next — Nghiệp vụ báo cáo
 * Port từ 17a-reports-ext: preset kỳ, metric, so sánh kỳ trước, top sản phẩm.
 */
import type { Sale, Product, Customer } from '../types'
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

export function buildReport(sales: Sale[], products: Product[], f: ReportFilters): ReportResult {
  const { from, to } = resolveRange(f)
  const active = sales.filter((s) => !s.voided)

  const inRange = active.filter((s) => {
    const d = localDay(s.date)
    if (d < from || d > to) return false
    if (f.pay !== 'all' && s.payMethod !== f.pay) return false
    if (f.customerId && s.customerId !== f.customerId) return false
    if (f.cat !== 'all') {
      const hasCat = s.items.some((it) => {
        const p = products.find((x) => x.id === it.productId)
        return p && p.cat === f.cat
      })
      if (!hasCat) return false
    }
    return true
  })

  const revenue = inRange.reduce((a, s) => a + s.total, 0)
  const profit = inRange.reduce((a, s) => a + s.profit, 0)
  const items = inRange.reduce((a, s) => a + s.items.reduce((x, i) => x + i.qty, 0), 0)

  // Chuỗi ngày
  const dailyMap: Record<string, { revenue: number; profit: number; orders: number }> = {}
  inRange.forEach((s) => {
    const d = localDay(s.date)
    if (!dailyMap[d]) dailyMap[d] = { revenue: 0, profit: 0, orders: 0 }
    dailyMap[d].revenue += s.total
    dailyMap[d].profit += s.profit
    dailyMap[d].orders += 1
  })
  const daily = Object.entries(dailyMap)
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Top sản phẩm
  const prodMap: Record<string, { qty: number; revenue: number; profit: number }> = {}
  inRange.forEach((s) => s.items.forEach((it) => {
    if (!prodMap[it.productId]) prodMap[it.productId] = { qty: 0, revenue: 0, profit: 0 }
    prodMap[it.productId].qty += it.qty
    prodMap[it.productId].revenue += it.price * it.qty
    prodMap[it.productId].profit += (it.price - it.cost) * it.qty
  }))
  const topProducts = Object.entries(prodMap)
    .map(([productId, v]) => ({
      productId,
      name: products.find((p) => p.id === productId)?.name || '—',
      ...v,
    }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 15)

  // Top danh mục
  const catMap: Record<string, { revenue: number; profit: number }> = {}
  inRange.forEach((s) => s.items.forEach((it) => {
    const p = products.find((x) => x.id === it.productId)
    const cat = p?.cat || 'Khác'
    if (!catMap[cat]) catMap[cat] = { revenue: 0, profit: 0 }
    catMap[cat].revenue += it.price * it.qty
    catMap[cat].profit += (it.price - it.cost) * it.qty
  }))
  const topCategories = Object.entries(catMap)
    .map(([cat, v]) => ({ cat, ...v }))
    .sort((a, b) => b.revenue - a.revenue)

  // Phân bổ thanh toán
  const payMap: Record<string, { count: number; amount: number }> = {}
  inRange.forEach((s) => {
    if (!payMap[s.payMethod]) payMap[s.payMethod] = { count: 0, amount: 0 }
    payMap[s.payMethod].count += 1
    payMap[s.payMethod].amount += s.total
  })
  const payLabels: Record<string, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', debt: 'Ghi nợ' }
  const payBreakdown = Object.entries(payMap).map(([method, v]) => ({
    method: payLabels[method] || method,
    ...v,
  }))

  // Kỳ trước
  let prev: ReportResult['prev']
  if (f.compare) {
    const pr = prevRange(from, to)
    const prevSales = active.filter((s) => {
      const d = localDay(s.date)
      return d >= pr.from && d <= pr.to
    })
    prev = {
      revenue: prevSales.reduce((a, s) => a + s.total, 0),
      profit: prevSales.reduce((a, s) => a + s.profit, 0),
      orders: prevSales.length,
    }
  }

  return {
    from, to, revenue, profit,
    orders: inRange.length,
    items,
    avgOrder: inRange.length > 0 ? Math.round(revenue / inRange.length) : 0,
    daily, topProducts, topCategories, payBreakdown, prev,
  }
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
    ['Sản phẩm', 'SL', 'Doanh thu', 'Lợi nhuận'],
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
