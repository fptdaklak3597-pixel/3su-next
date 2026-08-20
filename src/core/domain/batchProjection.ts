import { dbx } from '../db'
import { localDay, uid } from '../format'
import type { Product, ProductBatch } from '../types'
import { consumeBatchesFefo, liveBatchExpiry, restoreBatchesFefo } from './inventory-core'

export interface BatchProjectionStats {
  products: number
  batches: number
  staleRows: number
  repairedProducts: number
}

function finiteNonNegative(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback
}

/**
 * Product.batches là canonical state. Mỗi record mirror trong bảng batches luôn
 * mang productId và được clone/sanitize trước khi ghi.
 */
export function normalizeProductBatches(
  productId: string,
  batches: readonly ProductBatch[] | null | undefined,
): ProductBatch[] {
  const seen = new Set<string>()
  const normalized: ProductBatch[] = []
  for (const source of batches ?? []) {
    if (!source || typeof source.id !== 'string' || !source.id) continue
    if (seen.has(source.id)) continue
    seen.add(source.id)
    const qty = finiteNonNegative(source.qty)
    const remain = Math.min(qty, finiteNonNegative(source.remain))
    normalized.push({
      ...source,
      productId,
      qty,
      remain,
      cost: finiteNonNegative(source.cost),
      expiry: typeof source.expiry === 'string' ? source.expiry : '',
      date: typeof source.date === 'string' ? source.date : '',
      supId: typeof source.supId === 'string' ? source.supId : '',
      supName: typeof source.supName === 'string' ? source.supName : '',
    })
  }
  return normalized
}

function sameBatches(left: readonly ProductBatch[], right: readonly ProductBatch[]): boolean {
  if (left.length !== right.length) return false
  return left.every((batch, index) => {
    const other = right[index]
    return !!other
      && batch.id === other.id
      && batch.productId === other.productId
      && batch.qty === other.qty
      && batch.remain === other.remain
      && batch.cost === other.cost
      && batch.expiry === other.expiry
      && batch.date === other.date
      && (batch.supId ?? '') === (other.supId ?? '')
      && (batch.supName ?? '') === (other.supName ?? '')
  })
}

/**
 * Đồng bộ một Product object và bảng mirror. Caller phải khai báo products +
 * batches trong transaction hiện hành và tự put product sau khi hàm trả về.
 */
export async function syncProductBatchProjectionInTx(product: Product): Promise<{
  changed: boolean
  staleRows: number
}> {
  const previous = product.batches ?? []
  const normalized = normalizeProductBatches(product.id, previous)
  const expiry = liveBatchExpiry(normalized)
  const changed = !sameBatches(previous, normalized) || product.expiry !== expiry
  product.batches = normalized
  product.expiry = expiry

  const existingIds = await dbx.batches.where('productId').equals(product.id).primaryKeys()
  const wanted = new Set(normalized.map((batch) => batch.id))
  const stale = existingIds.filter((id) => !wanted.has(String(id))) as string[]
  if (stale.length > 0) await dbx.batches.bulkDelete(stale)
  if (normalized.length > 0) await dbx.batches.bulkPut(normalized)
  return { changed, staleRows: stale.length }
}

export async function reconcileProductBatchProjectionInTx(productId: string): Promise<BatchProjectionStats> {
  const product = await dbx.products.get(productId)
  if (!product) return { products: 0, batches: 0, staleRows: 0, repairedProducts: 0 }
  const result = await syncProductBatchProjectionInTx(product)
  if (result.changed) await dbx.products.put(product)
  return {
    products: 1,
    batches: product.batches.length,
    staleRows: result.staleRows,
    repairedProducts: result.changed ? 1 : 0,
  }
}

export async function reconcileProductBatchProjections(productIds: Iterable<string>): Promise<BatchProjectionStats> {
  const ids = [...new Set([...productIds].filter(Boolean))]
  if (ids.length === 0) return { products: 0, batches: 0, staleRows: 0, repairedProducts: 0 }
  return dbx.transaction('rw', [dbx.products, dbx.batches], async () => {
    const total: BatchProjectionStats = { products: 0, batches: 0, staleRows: 0, repairedProducts: 0 }
    for (const id of ids) {
      const stats = await reconcileProductBatchProjectionInTx(id)
      total.products += stats.products
      total.batches += stats.batches
      total.staleRows += stats.staleRows
      total.repairedProducts += stats.repairedProducts
    }
    return total
  })
}

/**
 * Boot/migration repair: xóa toàn bộ mirror rồi rebuild từ canonical state.
 * Cách này loại luôn orphan/legacy rows không có productId.
 */
export async function reconcileAllBatchProjections(): Promise<BatchProjectionStats> {
  return dbx.transaction('rw', [dbx.products, dbx.batches], async () => {
    const products = await dbx.products.toArray()
    const previousRows = await dbx.batches.count()
    const allBatches: ProductBatch[] = []
    let repairedProducts = 0

    await dbx.batches.clear()
    for (const product of products) {
      const previous = product.batches ?? []
      const normalized = normalizeProductBatches(product.id, previous)
      const expiry = liveBatchExpiry(normalized)
      if (!sameBatches(previous, normalized) || product.expiry !== expiry) {
        product.batches = normalized
        product.expiry = expiry
        await dbx.products.put(product)
        repairedProducts += 1
      }
      allBatches.push(...normalized)
    }
    if (allBatches.length > 0) await dbx.batches.bulkPut(allBatches)

    return {
      products: products.length,
      batches: allBatches.length,
      staleRows: Math.max(0, previousRows - allBatches.length),
      repairedProducts,
    }
  })
}

/** Điều chỉnh canonical batches trong transaction hiện hành. */
export async function applyStockDeltaToCanonicalBatchesInTx(
  product: Product,
  delta: number,
): Promise<ProductBatch[]> {
  if (!Number.isFinite(delta)) throw new Error('Delta tồn kho không hợp lệ')
  if (delta === 0) {
    await syncProductBatchProjectionInTx(product)
    return product.batches
  }

  if (delta < 0) {
    product.batches = consumeBatchesFefo(product.batches ?? [], -delta).batches
  } else {
    product.batches = [
      ...(product.batches ?? []),
      {
        id: uid('bt'),
        productId: product.id,
        qty: delta,
        remain: delta,
        cost: finiteNonNegative(product.cost),
        expiry: '',
        date: localDay(new Date()),
        supId: '',
        supName: 'Kiểm kê',
      },
    ]
  }
  await syncProductBatchProjectionInTx(product)
  return product.batches
}

/** Hoàn canonical batches và mirror trong transaction hiện hành. */
export async function restoreCanonicalBatchesInTx(
  product: Product,
  qty: number,
): Promise<ProductBatch[]> {
  if (!Number.isFinite(qty) || qty < 0) throw new Error('Số lượng hoàn lô không hợp lệ')
  product.batches = restoreBatchesFefo(product.batches ?? [], qty)
  await syncProductBatchProjectionInTx(product)
  return product.batches
}
