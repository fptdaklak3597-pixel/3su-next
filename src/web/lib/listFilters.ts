/**
 * Lọc / phân trang danh sách web — tách ra để test ổn định.
 */
import { expiryStatus, matchesSearch } from '@/core/format'
import type { Product, Sale } from '@/core/types'

export type StockFilter = 'all' | 'low' | 'out' | 'hsd'

export function filterProducts(
  products: Product[],
  opts: { query: string; filter: StockFilter; cat: string; lowStock: number; hsdWarnDays: number },
): Product[] {
  return products
    .filter((p) => !p.deleted)
    .filter((p) => {
      if (opts.cat && p.cat !== opts.cat) return false
      if (opts.filter === 'low' && !(p.stock > 0 && p.stock <= opts.lowStock)) return false
      if (opts.filter === 'out' && p.stock > 0) return false
      if (opts.filter === 'hsd') {
        const s = expiryStatus(p.expiry, opts.hsdWarnDays)
        if (s !== 'soon' && s !== 'expired') return false
      }
      if (!matchesSearch(`${p.name} ${p.cat} ${p.barcode}`, opts.query)) return false
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
}

export function paginate<T>(items: T[], page: number, size: number): { rows: T[]; pages: number; page: number } {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const safe = Math.min(Math.max(1, page), pages)
  const start = (safe - 1) * size
  return { rows: items.slice(start, start + size), pages, page: safe }
}

export function payLabel(m: Sale['payMethod'] | string): string {
  return ({ cash: 'Tiền mặt', transfer: 'CK', debt: 'Ghi nợ' } as Record<string, string>)[m] || m
}
