/**
 * 3SU Next — Nạp dữ liệu mẫu (port TinBumSeed500 từ 23-gr2-seeding.js)
 * Thêm nhanh 500 mặt hàng tạp hoá VN phổ biến kèm giá thị trường.
 * Tên đã tồn tại sẽ được bỏ qua (dedupe theo tên thường hoá).
 * Payload: public/seed-500.json (fetch lúc gọi seed, không nhồi main bundle).
 */
import { dbx } from '../db'
import type { Product } from '../types'
import { uid } from '../format'
import { makeOp, persistOp, requestFlush } from '../sync/engine'
import { requireOwnerAdmin } from './auth'
import { assertCloudShopWritable } from '../sync/license'
import type { SeedItem } from './seed-data'

export type { SeedItem }

export interface SeedResult {
  added: number
  skipped: number
}

let seedCache: SeedItem[] | null = null

async function loadSeed500(): Promise<SeedItem[]> {
  if (seedCache) return seedCache
  const res = await fetch('/seed-500.json')
  if (!res.ok) throw new Error(`Không tải được seed mẫu (${res.status})`)
  const data = await res.json() as SeedItem[]
  if (!Array.isArray(data) || data.length === 0) throw new Error('Seed mẫu rỗng hoặc sai định dạng')
  seedCache = data
  return data
}

/** Thống kê danh mục trong bộ seed (hiển thị dialog). */
export async function seedCategories(): Promise<{ cat: string; count: number }[]> {
  const items = await loadSeed500()
  const cats: Record<string, number> = {}
  items.forEach((s) => { cats[s.cat] = (cats[s.cat] || 0) + 1 })
  return Object.entries(cats)
    .map(([cat, count]) => ({ cat, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Nạp danh sách mặt hàng mẫu vào kho, ghi op sync cho từng SP mới.
 * @param stock Tồn kho ban đầu cho mỗi sản phẩm (mặc định 0).
 */
export async function seedCatalog(items: SeedItem[], stock = 0): Promise<SeedResult> {
  await requireOwnerAdmin()
  await assertCloudShopWritable()
  const existing = new Set(
    (await dbx.products.toArray()).map((p) => p.name.trim().toLowerCase()),
  )
  const now = Date.now()
  let added = 0
  let skipped = 0

  await dbx.transaction('rw', [dbx.products, dbx.stockMoves, dbx.syncQueue, dbx.appliedOps], async () => {
    for (const s of items) {
      const key = s.name.trim().toLowerCase()
      if (existing.has(key)) { skipped++; continue }

      const p: Product = {
        id: uid('p'),
        name: s.name,
        cat: s.cat || '',
        price: s.price,
        cost: s.cost,
        stock,
        unit: s.unit || 'cái',
        barcode: '',
        expiry: '',
        units: [],
        wholesalePrice: 0,
        batches: [],
        emoji: s.emoji || '📦',
        createdAt: now,
        updatedAt: now,
      }

      const upsertOp = makeOp('product.upsert', null)
      p.hlc = upsertOp.hlc
      await dbx.products.add(p)
      const { stock: _s, batches: _b, ...rest } = p
      upsertOp.payload = { product: rest }
      await persistOp(upsertOp)

      if (stock > 0) {
        const adjustOp = makeOp('stock.adjust', { productId: p.id, delta: stock, reason: 'init' })
        await dbx.stockMoves.add({
          id: 'mv_' + adjustOp.id,
          productId: p.id,
          type: 'adjust',
          qty: stock,
          cost: p.cost,
          note: 'Tồn kho ban đầu',
          refId: p.id,
          date: new Date().toISOString(),
          ts: now,
        })
        await persistOp(adjustOp)
      }

      existing.add(key)
      added++
    }
  })
  requestFlush()
  return { added, skipped }
}

export async function seed500(stock = 0): Promise<SeedResult> {
  return seedCatalog(await loadSeed500(), stock)
}
