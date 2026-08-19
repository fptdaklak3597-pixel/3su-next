/**
 * 3SU Next — Trợ lý hỏi đáp nhanh (Quick answers)
 * Port từ 18-quick-answers.js: trả lời tại chỗ về hôm nay/hôm qua/tuần/
 * bán chạy/khách nợ/hết hàng — không cần mạng, không cần AI.
 */
import { dbx } from '../db'
import { uid } from '../format'
import type { QuickAnswer, Product, Sale, Customer } from '../types'
import { dayStats, weekProfitSeries, totalDebt } from '../domain/sales'
import { fmt, today, yesterday, daysAgo, localDay, escapeHtml } from '../format'

/** Trả lời câu hỏi bằng tiếng Việt dựa trên dữ liệu hiện có. */
export function localChatAnswer(q: string, sales: Sale[], customers: Customer[], products: Product[], lowStock: number): string {
  const query = q.toLowerCase()
  const t = dayStats(sales, today())
  const y = dayStats(sales, yesterday())

  if (/hôm nay.*(bán|đơn|lời|doanh thu)|hôm nay/.test(query) && /bán|đơn|lời|doanh thu|nay/.test(query)) {
    return `Hôm nay bán <b>${t.orders}</b> đơn, doanh thu <b>${fmt(t.revenue)}</b>, lời <b>${fmt(t.profit)}</b>.`
  }
  if (/hôm qua/.test(query)) {
    return `Hôm qua bán <b>${y.orders}</b> đơn, doanh thu <b>${fmt(y.revenue)}</b>, lời <b>${fmt(y.profit)}</b>.`
  }
  if (/tuần/.test(query)) {
    const w = weekProfitSeries(sales, 7)
    const total = w.reduce((a, d) => a + d.profit, 0)
    return `Tuần qua (7 ngày) lời tổng <b>${fmt(total)}</b>.`
  }
  if (/bán chạy|top/.test(query)) {
    const top = topProducts(sales, today(), 3)
    if (top.length === 0) return 'Hôm nay chưa có đơn nào.'
    return 'Top hôm nay: ' + top.map((x) => `<b>${escapeHtml(x.name)}</b> (${x.qty})`).join(', ') + '.'
  }
  if (/nợ|khách nợ/.test(query)) {
    const debt = totalDebt(customers)
    const n = customers.filter((c) => !c.deleted && c.debt > 0).length
    return debt > 0 ? `Có <b>${n}</b> khách đang nợ tổng <b>${fmt(debt)}</b>.` : 'Không có khách nào đang nợ.'
  }
  if (/hết hàng|sắp hết|tồn kho/.test(query)) {
    const low = products.filter((p) => !p.deleted && p.stock <= lowStock)
    if (low.length === 0) return 'Kho hàng vẫn đầy đủ.'
    return 'Sắp hết: ' + low.slice(0, 5).map((p) => `<b>${escapeHtml(p.name)}</b> (${p.stock} ${escapeHtml(p.unit || '')})`).join(', ') + '.'
  }
  return 'Tôi có thể trả lời nhanh về: hôm nay, hôm qua, tuần qua, bán chạy, khách nợ, hết hàng.'
}

/** Top sản phẩm bán chạy trong một ngày. */
export function topProducts(sales: Sale[], date: string, limit: number): { name: string; qty: number }[] {
  const map: Record<string, { name: string; qty: number }> = {}
  for (const s of sales.filter((x) => !x.voided && localDay(x.date) === date)) {
    for (const it of s.items) {
      if (!map[it.productId]) map[it.productId] = { name: it.name, qty: 0 }
      map[it.productId].qty += it.qty
    }
  }
  return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, limit)
}

/** Top sản phẩm trong 7 ngày (port summariseDbForAI.topWeek). */
export function topProductsWeek(sales: Sale[], limit = 5): { name: string; qty: number; profit: number }[] {
  const map: Record<string, { name: string; qty: number; profit: number }> = {}
  const from = daysAgo(7)
  for (const s of sales.filter((x) => !x.voided && localDay(x.date) >= from)) {
    for (const it of s.items) {
      if (!map[it.productId]) map[it.productId] = { name: it.name, qty: 0, profit: 0 }
      map[it.productId].qty += it.qty
      map[it.productId].profit += it.qty * (it.price - it.cost)
    }
  }
  return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, limit)
}

/* ─── CRUD câu trả lời nhanh tùy chỉnh ─── */
export async function createQuickAnswer(q: string, a: string): Promise<QuickAnswer> {
  if (!q.trim()) throw new Error('Cần câu hỏi')
  const rec: QuickAnswer = { id: uid('qa'), q: q.trim(), a: a.trim() }
  await dbx.quickAnswers.put(rec)
  return rec
}

export async function deleteQuickAnswer(id: string): Promise<void> {
  await dbx.quickAnswers.delete(id)
}

/** Tìm câu trả lời tùy chỉnh khớp trước, fallback trợ lý tự động. */
export async function answerQuestion(q: string, sales: Sale[], customers: Customer[], products: Product[], lowStock: number): Promise<string> {
  const custom = await dbx.quickAnswers.toArray()
  const ql = q.toLowerCase().trim()
  const hit = custom.find((c) => ql.includes(c.q.toLowerCase()) || c.q.toLowerCase().includes(ql))
  if (hit) return hit.a
  return localChatAnswer(q, sales, customers, products, lowStock)
}
