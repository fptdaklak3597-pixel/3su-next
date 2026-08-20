export * from './inventory-core'

import type { Product, ProductBatch } from '../types'
import {
  applyGoodsReceiptInTx as applyGoodsReceiptInTxCore,
  saveGoodsReceipt as saveGoodsReceiptCore,
  saveStocktake as saveStocktakeCore,
  updateProduct as updateProductCore,
} from './inventory-core'
import {
  applyStockDeltaToCanonicalBatchesInTx,
  reconcileProductBatchProjectionInTx,
  reconcileProductBatchProjections,
} from './batchProjection'

/**
 * Public inventory facade. The preserved implementation remains in
 * inventory-core.ts; mutation exits reconcile the canonical embedded batch
 * state with the IndexedDB projection.
 */
export async function updateProduct(
  id: string,
  patch: Parameters<typeof updateProductCore>[1],
): Promise<void> {
  await updateProductCore(id, patch)
  await reconcileProductBatchProjections([id])
}

/** Called by remote reducers and transaction-aware domain code. */
export async function applyStockDeltaToBatches(
  product: Product,
  delta: number,
): Promise<ProductBatch[]> {
  return applyStockDeltaToCanonicalBatchesInTx(product, delta)
}

export async function applyGoodsReceiptInTx(
  input: Parameters<typeof applyGoodsReceiptInTxCore>[0],
): ReturnType<typeof applyGoodsReceiptInTxCore> {
  const receipt = await applyGoodsReceiptInTxCore(input)
  for (const productId of new Set(receipt.rows.map((row) => row.productId))) {
    await reconcileProductBatchProjectionInTx(productId)
  }
  return receipt
}

export async function saveGoodsReceipt(
  input: Parameters<typeof saveGoodsReceiptCore>[0],
): ReturnType<typeof saveGoodsReceiptCore> {
  const receipt = await saveGoodsReceiptCore(input)
  await reconcileProductBatchProjections(receipt.rows.map((row) => row.productId))
  return receipt
}

export async function saveStocktake(
  rows: Parameters<typeof saveStocktakeCore>[0],
  note: Parameters<typeof saveStocktakeCore>[1],
): ReturnType<typeof saveStocktakeCore> {
  const record = await saveStocktakeCore(rows, note)
  await reconcileProductBatchProjections(record.rows.map((row) => row.productId))
  return record
}
