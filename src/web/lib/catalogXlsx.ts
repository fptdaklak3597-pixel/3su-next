/**
 * Xuất / nhập danh mục hàng hóa (Excel).
 * Khớp theo mã vạch, không có mã thì khớp tên. Tồn chỉ ghi khi tạo mới.
 */
import { normalizeVi } from '@/core/format'
import { addProduct, updateProduct } from '@/core/domain/inventory'
import type { Product } from '@/core/types'

export interface CatalogDraft {
  barcode: string
  name: string
  cat: string
  unit: string
  price: number
  cost: number
  stock: number
  wholesalePrice: number
  expiry: string
}

export const CATALOG_HEADERS = ['Mã hàng', 'Tên hàng', 'Nhóm', 'Đơn vị', 'Giá bán', 'Giá vốn', 'Tồn', 'Giá sỉ', 'HSD'] as const

const HEADER_KEY: Record<string, keyof CatalogDraft> = {
  barcode: 'barcode',
  ma: 'barcode',
  'ma hang': 'barcode',
  name: 'name',
  ten: 'name',
  'ten hang': 'name',
  cat: 'cat',
  nhom: 'cat',
  'nhom hang': 'cat',
  'danh muc': 'cat',
  unit: 'unit',
  'don vi': 'unit',
  price: 'price',
  gia: 'price',
  'gia ban': 'price',
  cost: 'cost',
  von: 'cost',
  'gia von': 'cost',
  stock: 'stock',
  ton: 'stock',
  'ton kho': 'stock',
  wholesaleprice: 'wholesalePrice',
  'gia si': 'wholesalePrice',
  expiry: 'expiry',
  hsd: 'expiry',
  'han su dung': 'expiry',
}

function headerKey(h: unknown): keyof CatalogDraft | null {
  const n = normalizeVi(String(h ?? '')).replace(/\s+/g, ' ').trim()
  return HEADER_KEY[n] ?? null
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = String(v ?? '').replace(/[.\sđ₫]/g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

export function parseCatalogSheet(rows: unknown[][]): CatalogDraft[] {
  if (rows.length < 2) return []
  const keys = (rows[0] as unknown[]).map(headerKey)
  if (!keys.some((k) => k === 'name' || k === 'barcode')) return []
  const out: CatalogDraft[] = []
  for (const raw of rows.slice(1)) {
    const line = Array.isArray(raw) ? raw : []
    const draft: CatalogDraft = {
      barcode: '', name: '', cat: '', unit: 'cái',
      price: 0, cost: 0, stock: 0, wholesalePrice: 0, expiry: '',
    }
    keys.forEach((k, i) => {
      if (!k) return
      const v = line[i]
      if (k === 'price' || k === 'cost' || k === 'stock' || k === 'wholesalePrice') draft[k] = num(v)
      else draft[k] = String(v ?? '').trim()
    })
    if (!draft.name && !draft.barcode) continue
    out.push(draft)
  }
  return out
}

/** Dòng Excel lỗi (1-based, gồm header = dòng 1). */
export function catalogRowIssues(rows: unknown[][]): { row: number; message: string }[] {
  if (rows.length < 2) return []
  const drafts = parseCatalogSheet(rows)
  const issues: { row: number; message: string }[] = []
  let dataIdx = 0
  for (let i = 1; i < rows.length; i++) {
    const line = Array.isArray(rows[i]) ? rows[i] as unknown[] : []
    const empty = line.every((c) => String(c ?? '').trim() === '')
    if (empty) continue
    const draft = drafts[dataIdx]
    dataIdx += 1
    if (!draft) {
      issues.push({ row: i + 1, message: 'Không đọc được dòng' })
      continue
    }
    if (!draft.name.trim()) issues.push({ row: i + 1, message: 'Thiếu tên hàng' })
  }
  return issues
}

export function matchCatalogTarget(draft: CatalogDraft, products: Product[]): Product | undefined {
  const code = draft.barcode.trim()
  if (code) {
    const byCode = products.find((p) => !p.deleted && p.barcode && p.barcode === code)
    if (byCode) return byCode
  }
  const name = draft.name.trim().toLowerCase()
  if (!name) return undefined
  return products.find((p) => !p.deleted && p.name.trim().toLowerCase() === name)
}

export async function applyCatalogDrafts(
  drafts: CatalogDraft[],
  products: Product[],
): Promise<{ added: number; updated: number; skipped: number }> {
  let added = 0
  let updated = 0
  let skipped = 0
  const known = products.slice()
  for (const d of drafts) {
    const name = d.name.trim()
    if (!name) { skipped += 1; continue }
    const hit = matchCatalogTarget(d, known)
    if (hit) {
      await updateProduct(hit.id, {
        name,
        cat: d.cat.trim() || hit.cat,
        unit: d.unit.trim() || hit.unit,
        price: d.price,
        cost: d.cost,
        barcode: d.barcode.trim() || hit.barcode,
        expiry: d.expiry.trim() || hit.expiry,
        wholesalePrice: d.wholesalePrice,
      })
      updated += 1
    } else {
      const created = await addProduct({
        name,
        cat: d.cat.trim() || 'Khác',
        unit: d.unit.trim() || 'cái',
        price: d.price,
        cost: d.cost,
        stock: d.stock,
        barcode: d.barcode.trim(),
        expiry: d.expiry.trim(),
        wholesalePrice: d.wholesalePrice,
      })
      known.push(created)
      added += 1
    }
  }
  return { added, updated, skipped }
}

export async function exportCatalogXlsx(products: Product[]): Promise<void> {
  const XLSX = await import('xlsx')
  const body = products.filter((p) => !p.deleted).map((p) => ([
    p.barcode, p.name, p.cat, p.unit, p.price, p.cost, p.stock, p.wholesalePrice, p.expiry,
  ]))
  const ws = XLSX.utils.aoa_to_sheet([CATALOG_HEADERS.slice(), ...body])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Hang hoa')
  XLSX.writeFile(wb, `3su-hang-hoa-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export async function importCatalogXlsx(file: File, products: Product[]): Promise<{
  added: number
  updated: number
  skipped: number
  errors: { row: number; message: string }[]
}> {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
  const errors = catalogRowIssues(rows)
  const stats = await applyCatalogDrafts(parseCatalogSheet(rows), products)
  return { ...stats, errors }
}
