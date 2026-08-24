/**
 * Alias tên hoá đơn → productId. Lưu meta local (giống db.productAliases bản cũ).
 */
import { getMeta, setMeta } from '../db'
import { upsertAlias, type ProductAlias } from './productMatcher'

const META_KEY = 'productAliases'

export async function loadProductAliases(): Promise<ProductAlias[]> {
  const list = await getMeta<ProductAlias[]>(META_KEY, [])
  return Array.isArray(list) ? list : []
}

export async function learnProductAlias(
  name: string,
  sku: string,
  supId: string,
  pid: string,
): Promise<void> {
  const cur = await loadProductAliases()
  await setMeta(META_KEY, upsertAlias(cur, name, sku, supId, pid))
}
