/**
 * Nhận hàng từ PO: id phiếu ổn định + đối soát SL để hai máy không nhập trùng.
 */
import { dbx } from '../db'
import type { GoodsReceipt, PurchaseOrder, PurchaseOrderRow } from '../types'

export function fnv1a32Hex(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function poLineKey(row: PurchaseOrderRow, index: number): string {
  return row.lineId || `${row.productId}#${index}`
}

export function goodsReceiptIdForPurchaseOrder(
  poId: string,
  takes: Array<{ lineKey: string; priorReceived: number; qty: number }>,
): string {
  const fp = takes
    .map((t) => `${t.lineKey}:${t.priorReceived}:${t.qty}`)
    .sort()
    .join('|')
  return `gr_po_${poId}_${fnv1a32Hex(fp)}`
}

function rowQty(row: { qty?: number }): number {
  return Number.isFinite(row.qty) ? Math.max(0, row.qty as number) : 0
}

/** Cộng SL các phiếu nhập lên dòng PO (ưu tiên lineId; phiếu cũ không lineId chia theo productId). */
export function applyReceiptsToPoRows(
  rows: PurchaseOrderRow[],
  receipts: GoodsReceipt[],
): PurchaseOrderRow[] {
  const byLine = new Map<string, number>()
  const byProduct = new Map<string, number>()
  for (const gr of receipts) {
    for (const row of gr.rows || []) {
      const qty = rowQty(row)
      if (row.lineId) byLine.set(row.lineId, (byLine.get(row.lineId) ?? 0) + qty)
      else byProduct.set(row.productId, (byProduct.get(row.productId) ?? 0) + qty)
    }
  }
  return rows.map((row, index) => {
    const key = poLineKey(row, index)
    let got = byLine.get(key) ?? (row.lineId ? (byLine.get(row.lineId) ?? 0) : 0)
    const leftover = byProduct.get(row.productId) ?? 0
    const room = Math.max(0, row.qty - got)
    const take = Math.min(room, leftover)
    if (take > 0) {
      got += take
      byProduct.set(row.productId, leftover - take)
    }
    return { ...row, receivedQty: Math.min(row.qty, Math.max(0, got)) }
  })
}

export function poReceiveWouldOverflow(
  po: PurchaseOrder,
  existing: GoodsReceipt[],
  incoming: Pick<GoodsReceipt, 'rows'>,
): boolean {
  if (po.status === 'cancelled') return true
  const afterExisting = applyReceiptsToPoRows(po.rows, existing)
  const remainByLine = new Map<string, number>()
  const remainByProduct = new Map<string, number>()
  afterExisting.forEach((row, index) => {
    const left = Math.max(0, row.qty - (row.receivedQty || 0))
    remainByLine.set(poLineKey(row, index), left)
    remainByProduct.set(row.productId, (remainByProduct.get(row.productId) ?? 0) + left)
  })

  for (const row of incoming.rows || []) {
    const qty = rowQty(row)
    if (qty <= 0) continue
    if (row.lineId && remainByLine.has(row.lineId)) {
      const left = remainByLine.get(row.lineId) ?? 0
      if (qty > left) return true
      remainByLine.set(row.lineId, left - qty)
      remainByProduct.set(row.productId, (remainByProduct.get(row.productId) ?? 0) - qty)
      continue
    }
    const pLeft = remainByProduct.get(row.productId) ?? 0
    if (qty > pLeft) return true
    remainByProduct.set(row.productId, pLeft - qty)
  }
  return false
}

export async function receiptsForPurchaseOrder(poId: string): Promise<GoodsReceipt[]> {
  const all = await dbx.goodsReceipts.toArray()
  return all.filter((g) => g.purchaseOrderId === poId)
}

export async function poReceiveWouldOverflowInTx(
  incoming: Pick<GoodsReceipt, 'id' | 'purchaseOrderId' | 'rows'>,
): Promise<boolean> {
  const poId = incoming.purchaseOrderId
  if (!poId) return false
  const po = await dbx.purchaseOrders.get(poId)
  if (!po) return false
  const existing = (await receiptsForPurchaseOrder(poId)).filter((g) => g.id !== incoming.id)
  return poReceiveWouldOverflow(po, existing, incoming)
}

/** Ghi lại receivedQty/status từ phiếu nhập thật. Chỉ khi đã có GR gắn PO. */
export async function syncPoReceiveFromReceiptsInTx(poId: string | undefined): Promise<void> {
  if (!poId) return
  const po = await dbx.purchaseOrders.get(poId)
  if (!po) return
  const receipts = await receiptsForPurchaseOrder(poId)
  if (receipts.length === 0) return
  const rows = applyReceiptsToPoRows(po.rows, receipts)
  const fulfilled = rows.every((row) => (row.receivedQty || 0) >= row.qty)
  let status = po.status
  if (status !== 'cancelled' && status !== 'draft') {
    status = fulfilled ? 'received' : 'ordered'
  }
  await dbx.purchaseOrders.put({ ...po, rows, status })
}
