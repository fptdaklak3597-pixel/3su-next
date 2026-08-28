import { dbx, getSettings } from '../db'
import { saveSettingsSynced } from './settings'
import type { Product, WholesaleFormula } from '../types'
import { updateProduct } from './inventory'
import {
  applyWholesaleFormulaToProduct,
  computeWholesalePrice,
  parseWholesaleFormula,
  wholesaleFormulaLabel,
} from './wholesale-formula'

export {
  computeWholesalePrice,
  parseWholesaleFormula,
  roundWholesalePrice,
  wholesaleFormulaLabel,
} from './wholesale-formula'

export async function getWholesaleFormula(): Promise<WholesaleFormula | null> {
  const s = await getSettings()
  return parseWholesaleFormula(s.wholesaleFormula)
}

export async function saveWholesaleFormula(formula: WholesaleFormula): Promise<number> {
  const s = await getSettings()
  s.wholesaleFormula = {
    mode: formula.mode === 'fixed' ? 'fixed' : 'percent',
    value: Math.max(0, formula.value),
  }
  await saveSettingsSynced(s)
  return applyWholesaleToAll(true)
}

export async function applyWholesaleToAll(force = false): Promise<number> {
  const cfg = await getWholesaleFormula()
  if (!cfg) return 0
  const products = await dbx.products.filter((p) => !p.deleted).toArray()
  let n = 0
  for (const p of products) {
    if ((Number(p.price) || 0) <= 0) continue
    const draft = { price: p.price, wholesalePrice: p.wholesalePrice }
    if (!applyWholesaleFormulaToProduct(draft, cfg, { force })) continue
    await updateProduct(p.id, { wholesalePrice: draft.wholesalePrice })
    n++
  }
  return n
}

export async function setProductWholesalePrice(productId: string, value: number): Promise<void> {
  const n = Math.max(0, Math.round(Number(value) || 0))
  await updateProduct(productId, { wholesalePrice: n })
}

export function wholesaleStats(products: Product[]): { total: number; withRetail: number; withWs: number } {
  const withRetail = products.filter((p) => (Number(p.price) || 0) > 0)
  const withWs = withRetail.filter((p) => (Number(p.wholesalePrice) || 0) > 0)
  return { total: products.length, withRetail: withRetail.length, withWs: withWs.length }
}

export function previewWholesalePrice(retail: number, cfg: WholesaleFormula | null): number {
  return computeWholesalePrice(retail, cfg)
}

/** Gọi khi đổi giá lẻ — trả wholesalePrice mới hoặc undefined nếu giữ nguyên. */
export function wholesalePriceAfterRetailChange(
  product: { price: number; wholesalePrice?: number },
  newRetail: number,
  cfg: WholesaleFormula | null,
): number | undefined {
  if (!cfg) return undefined
  const draft = { price: newRetail, wholesalePrice: product.wholesalePrice }
  if (!applyWholesaleFormulaToProduct(draft, cfg, { oldRetail: product.price })) return undefined
  return draft.wholesalePrice
}
