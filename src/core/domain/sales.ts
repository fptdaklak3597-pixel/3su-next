export * from './sales-core'

import { dbx } from '../db'
import {
  confirmSale as confirmSaleCore,
  voidSale as voidSaleCore,
} from './sales-core'
import { reconcileProductBatchProjections } from './batchProjection'

/** Public sale facade: preserve business behavior, then repair the batch mirror. */
export async function confirmSale(
  input: Parameters<typeof confirmSaleCore>[0],
): ReturnType<typeof confirmSaleCore> {
  const result = await confirmSaleCore(input)
  await reconcileProductBatchProjections(result.sale.items.map((item) => item.productId))
  return result
}

export async function voidSale(
  saleId: Parameters<typeof voidSaleCore>[0],
  reason: Parameters<typeof voidSaleCore>[1],
): ReturnType<typeof voidSaleCore> {
  const result = await voidSaleCore(saleId, reason)
  const sale = await dbx.sales.get(saleId)
  if (sale) await reconcileProductBatchProjections(sale.items.map((item) => item.productId))
  return result
}

export { salesInDateRange } from './sales-core'
