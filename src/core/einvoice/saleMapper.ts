/**
 * Map cloud SaleCommitted payload → local Sale for print/UI.
 */
import type { PayMethod, Sale, SaleItem } from '../types'

export interface AuthoritativeSalePayload {
  id: string
  items: Array<{
    productId: string
    name: string
    qty: number
    unitName: string
    unitRatio: number
    price: number
    cost: number
  }>
  total: number
  profit: number
  discount: number
  payMethod: string
  debtAmount: number
  customerId?: string
  occurredAt: string
}

export function saleFromAuthoritativePayload(
  payload: AuthoritativeSalePayload,
  tenderedHint?: number,
): Sale {
  const payMethod = payload.payMethod as PayMethod
  const items: SaleItem[] = payload.items.map((it) => ({
    productId: it.productId,
    name: it.name,
    qty: it.qty,
    price: it.price,
    cost: it.cost,
    unit: it.unitName,
    unitRatio: it.unitRatio,
  }))
  const total = payload.total
  const debtAmount = payload.debtAmount ?? 0
  const tendered =
    payMethod === 'debt'
      ? 0
      : Number.isFinite(tenderedHint)
        ? Math.max(0, tenderedHint!)
        : Math.max(0, total - debtAmount)
  return {
    id: payload.id,
    items,
    total,
    profit: payload.profit,
    discount: payload.discount,
    payMethod,
    tendered,
    change: payMethod === 'debt' ? 0 : Math.max(0, tendered - total),
    debtAmount,
    customerId: payload.customerId ?? null,
    date: payload.occurredAt,
    synced: true,
  }
}
