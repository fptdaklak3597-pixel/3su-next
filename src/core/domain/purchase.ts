/**
 * 3SU Next — Đơn mua hàng (Purchase Orders)
 * Port nghiệp vụ từ 26-purchase-orders.js.
 *
 * Vòng đời: draft → ordered → received (nhập kho) | cancelled.
 * Khi "received": tạo phiếu nhập (goodsReceipt) → cập nhật tồn kho + công nợ NCC.
 */
import { dbx } from '../db'
import { uid, today } from '../format'
import type { Product, PurchaseOrder, PurchaseOrderRow, StockForecast } from '../types'
import { applyGoodsReceiptInTx } from './inventory'
import { makeOp, persistOp, requestFlush } from '../sync/engine'

/** Dự báo → dòng PO (chỉ món gợi ý nhập > 0). */
export function forecastToPoRows(
  forecast: StockForecast[],
  products: Product[],
): Omit<PurchaseOrderRow, 'receivedQty'>[] {
  return forecast
    .filter((f) => f.suggestedQty > 0)
    .map((f) => {
      const p = products.find((x) => x.id === f.productId)
      return {
        productId: f.productId,
        name: f.name,
        unit: p?.unit || 'cái',
        qty: f.suggestedQty,
        cost: p?.cost || 0,
      }
    })
}

export const PO_STATUS_LABEL: Record<PurchaseOrder['status'], string> = {
  draft: 'Nháp',
  ordered: 'Đã đặt',
  received: 'Đã nhập',
  cancelled: 'Đã hủy',
}

export interface PurchaseOrderInput {
  supplierId: string
  supplierName: string
  rows: Omit<PurchaseOrderRow, 'receivedQty'>[]
  note?: string
  date?: string
}

/** Tạo đơn mua hàng (trạng thái nháp/đã đặt). */
export async function createPurchaseOrder(input: PurchaseOrderInput): Promise<PurchaseOrder> {
  if (!input.rows.length) throw new Error('Chưa có mặt hàng')
  const date = input.date ?? today()
  const code = 'PO-' + date.replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 900) + 100)
  const total = input.rows.reduce((a, r) => a + r.qty * r.cost, 0)
  const po: PurchaseOrder = {
    id: uid('po'),
    code,
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    rows: input.rows.map((r) => ({ ...r, receivedQty: 0 })),
    total,
    status: 'ordered',
    note: (input.note ?? '').trim(),
    date,
    ts: Date.now(),
  }
  await dbx.transaction('rw', [dbx.purchaseOrders, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('po.upsert', null)
    po.hlc = op.hlc
    await dbx.purchaseOrders.put(po)
    op.payload = po
    await persistOp(op)
  })
  requestFlush()
  return po
}

export async function updatePurchaseOrderStatus(
  id: string,
  status: PurchaseOrder['status'],
): Promise<void> {
  const po = await dbx.purchaseOrders.get(id)
  if (!po) return
  po.status = status
  await dbx.transaction('rw', [dbx.purchaseOrders, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('po.upsert', null)
    po.hlc = op.hlc
    await dbx.purchaseOrders.put(po)
    op.payload = po
    await persistOp(op)
  })
  requestFlush()
}

/**
 * Nhận hàng từ PO: tạo phiếu nhập kho (cập nhật tồn + công nợ NCC),
 * đánh dấu PO đã nhập và ghi receivedQty.
 */
export async function receivePurchaseOrder(
  id: string,
  opts: {
    paid?: number
    payMethod?: 'cash' | 'transfer' | 'debt'
    expiry?: string
    /** SL nhận lần này theo productId; bỏ trống = nhận hết phần còn. */
    qtys?: Record<string, number>
  } = {},
): Promise<void> {
  const po = await dbx.purchaseOrders.get(id)
  if (!po) throw new Error('Không tìm thấy đơn mua hàng')
  if (po.status === 'received') throw new Error('Đơn này đã nhập kho rồi')
  if (po.status === 'cancelled') throw new Error('Đơn đã hủy, không thể nhập')

  const takes = po.rows.map((r) => {
    const remain = Math.max(0, r.qty - (r.receivedQty || 0))
    const want = opts.qtys ? Math.min(remain, Math.max(0, Number(opts.qtys[r.productId]) || 0)) : remain
    return { row: r, take: want }
  }).filter((x) => x.take > 0)

  if (!takes.length) throw new Error('Không còn hàng để nhận')

  await dbx.transaction(
    'rw',
    [
      dbx.products, dbx.goodsReceipts, dbx.stockMoves, dbx.suppliers, dbx.supplierPayments,
      dbx.batches, dbx.priceLog, dbx.purchaseOrders, dbx.syncQueue, dbx.appliedOps,
    ],
    async () => {
      const gr = await applyGoodsReceiptInTx({
        supplier: po.supplierName,
        supplierId: po.supplierId,
        date: today(),
        expiry: opts.expiry ?? '',
        note: 'Nhập từ ' + po.code,
        rows: takes.map(({ row, take }) => ({
          productId: row.productId,
          name: row.name,
          unit: row.unit,
          unitRatio: 1,
          qty: take,
          cost: row.cost,
          expiry: '',
        })),
        paid: opts.paid ?? 0,
        payMethod: opts.payMethod,
      })

      po.rows = po.rows.map((r) => {
        const hit = takes.find((x) => x.row.productId === r.productId)
        return { ...r, receivedQty: (r.receivedQty || 0) + (hit?.take ?? 0) }
      })
      po.status = po.rows.every((r) => (r.receivedQty || 0) >= r.qty) ? 'received' : 'ordered'
      po.note = (po.note ? po.note + ' · ' : '') + 'Phiếu nhập ' + gr.code
      const op = makeOp('po.upsert', null)
      po.hlc = op.hlc
      await dbx.purchaseOrders.put(po)
      op.payload = po
      await persistOp(op)
    },
  )
  requestFlush()
}

/** Gom tất cả nguồn nhập (phiếu nhập + PO) thành một danh sách — port allPurchaseOrders(). */
export interface AggregatedPurchase {
  key: string
  kind: 'gr' | 'po'
  code: string
  supplierName: string
  date: string
  ts: number
  itemCount: number
  total: number
  paid: number
  debt: number
  note: string
}

export function aggregatePurchases(
  receipts: { id: string; code: string; supplier: string; date: string; ts: number; total: number; paid?: number; note: string; rows: unknown[] }[],
  pos: PurchaseOrder[],
): AggregatedPurchase[] {
  const out: AggregatedPurchase[] = []
  for (const g of receipts) {
    out.push({
      key: 'gr:' + g.id,
      kind: 'gr',
      code: g.code,
      supplierName: g.supplier,
      date: g.date,
      ts: g.ts,
      itemCount: g.rows.length,
      total: g.total,
      paid: g.paid ?? 0,
      debt: Math.max(0, g.total - (g.paid ?? 0)),
      note: g.note,
    })
  }
  for (const po of pos) {
    if (po.status === 'received') continue
    out.push({
      key: 'po:' + po.id,
      kind: 'po',
      code: po.code,
      supplierName: po.supplierName,
      date: po.date,
      ts: po.ts,
      itemCount: po.rows.length,
      total: po.total,
      paid: 0,
      debt: po.total,
      note: po.note,
    })
  }
  out.sort((a, b) => b.ts - a.ts)
  return out
}
