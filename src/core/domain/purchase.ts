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
import { withExclusiveLock } from '../offline'
import { requirePermission } from './auth'

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

function normalizePoRows(rows: PurchaseOrderInput['rows']): PurchaseOrderRow[] {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Chưa có mặt hàng')
  const seenLineIds = new Set<string>()
  return rows.map((row) => {
    if (!row?.productId) throw new Error('Dòng đơn mua thiếu sản phẩm')
    if (!Number.isFinite(row.qty) || row.qty <= 0) throw new Error(`Số lượng không hợp lệ: ${row.name || row.productId}`)
    if (!Number.isFinite(row.cost) || row.cost < 0) throw new Error(`Giá nhập không hợp lệ: ${row.name || row.productId}`)
    const unitRatio = row.unitRatio ?? 1
    if (!Number.isFinite(unitRatio) || unitRatio <= 0) throw new Error(`Quy đổi đơn vị không hợp lệ: ${row.name || row.productId}`)
    let lineId = row.lineId?.trim() || uid('por')
    while (seenLineIds.has(lineId)) lineId = uid('por')
    seenLineIds.add(lineId)
    return {
      lineId,
      productId: row.productId,
      name: String(row.name || '').trim() || row.productId,
      unit: String(row.unit || '').trim() || 'cái',
      unitRatio,
      qty: row.qty,
      cost: Math.round(row.cost),
      receivedQty: 0,
    }
  })
}

/** Tạo đơn mua hàng (trạng thái đã đặt). */
export async function createPurchaseOrder(input: PurchaseOrderInput): Promise<PurchaseOrder> {
  await requirePermission('inventory')
  const rows = normalizePoRows(input.rows)
  const date = input.date ?? today()
  const code = 'PO-' + date.replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 900) + 100)
  const total = Math.round(rows.reduce((a, r) => a + r.qty * r.cost, 0))
  if (!Number.isFinite(total) || total < 0) throw new Error('Tổng đơn mua không hợp lệ')
  const po: PurchaseOrder = {
    id: uid('po'),
    code,
    supplierId: input.supplierId,
    supplierName: input.supplierName.trim(),
    rows,
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

function assertPoTransition(from: PurchaseOrder['status'], to: PurchaseOrder['status']): void {
  if (from === to) return
  if (to === 'received') throw new Error('Dùng chức năng nhận hàng để hoàn tất đơn mua')
  const allowed =
    (from === 'draft' && (to === 'ordered' || to === 'cancelled'))
    || (from === 'ordered' && to === 'cancelled')
  if (!allowed) throw new Error(`Không thể chuyển đơn mua từ ${PO_STATUS_LABEL[from]} sang ${PO_STATUS_LABEL[to]}`)
}

export async function updatePurchaseOrderStatus(
  id: string,
  status: PurchaseOrder['status'],
): Promise<void> {
  await requirePermission('inventory')
  await withExclusiveLock('po-status-' + id, async () => {
    await dbx.transaction('rw', [dbx.purchaseOrders, dbx.syncQueue, dbx.appliedOps], async () => {
      const po = await dbx.purchaseOrders.get(id)
      if (!po) throw new Error('Không tìm thấy đơn mua hàng')
      assertPoTransition(po.status, status)
      if (po.status === status) return
      po.status = status
      const op = makeOp('po.upsert', null)
      po.hlc = op.hlc
      await dbx.purchaseOrders.put(po)
      op.payload = po
      await persistOp(op)
    })
  })
  requestFlush()
}

function rowKey(row: PurchaseOrderRow, index: number): string {
  return row.lineId || `${row.productId}#${index}`
}

function requestedQty(
  qtys: Record<string, number> | undefined,
  row: PurchaseOrderRow,
  index: number,
  remain: number,
): number {
  if (!qtys) return remain
  const raw = qtys[rowKey(row, index)] ?? qtys[row.lineId || ''] ?? qtys[row.productId] ?? 0
  if (!Number.isFinite(raw) || raw < 0) throw new Error(`Số lượng nhận không hợp lệ: ${row.name}`)
  return Math.min(remain, raw)
}

/**
 * Nhận hàng từ PO: tạo phiếu nhập kho (cập nhật tồn + công nợ NCC),
 * đánh dấu PO đã nhập và ghi receivedQty. Mọi phép tính dựa trên PO đọc lại trong transaction.
 */
export async function receivePurchaseOrder(
  id: string,
  opts: {
    paid?: number
    payMethod?: 'cash' | 'transfer' | 'debt'
    expiry?: string
    /** SL nhận lần này theo lineId; productId vẫn được hỗ trợ cho PO legacy/UI cũ. */
    qtys?: Record<string, number>
  } = {},
): Promise<void> {
  await requirePermission('inventory')
  await withExclusiveLock('po-receive-' + id, async () => {
    await dbx.transaction(
      'rw',
      [
        dbx.products, dbx.goodsReceipts, dbx.stockMoves, dbx.suppliers, dbx.supplierPayments,
        dbx.batches, dbx.priceLog, dbx.purchaseOrders, dbx.syncQueue, dbx.appliedOps,
      ],
      async () => {
        const po = await dbx.purchaseOrders.get(id)
        if (!po) throw new Error('Không tìm thấy đơn mua hàng')
        if (po.status === 'received') throw new Error('Đơn này đã nhập kho rồi')
        if (po.status === 'cancelled') throw new Error('Đơn đã hủy, không thể nhập')
        if (po.status !== 'ordered') throw new Error('Đơn mua chưa ở trạng thái có thể nhận hàng')

        const takes = po.rows.map((row, index) => {
          if (!Number.isFinite(row.qty) || row.qty <= 0) throw new Error(`Dòng PO không hợp lệ: ${row.name}`)
          const received = Number.isFinite(row.receivedQty) ? Math.max(0, row.receivedQty) : 0
          const remain = Math.max(0, row.qty - received)
          const take = requestedQty(opts.qtys, row, index, remain)
          return { index, row, take }
        }).filter((x) => x.take > 0)

        if (!takes.length) throw new Error('Không còn hàng để nhận')

        const gr = await applyGoodsReceiptInTx({
          supplier: po.supplierName,
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          date: today(),
          expiry: opts.expiry ?? '',
          note: 'Nhập từ ' + po.code,
          rows: takes.map(({ row, take }) => ({
            productId: row.productId,
            name: row.name,
            unit: row.unit,
            unitRatio: row.unitRatio ?? 1,
            qty: take,
            cost: row.cost,
            expiry: '',
          })),
          paid: opts.paid,
          payMethod: opts.payMethod,
        })

        const receivedByIndex = new Map(takes.map((take) => [take.index, take.take]))
        po.rows = po.rows.map((row, index) => ({
          ...row,
          lineId: row.lineId || rowKey(row, index),
          unitRatio: row.unitRatio ?? 1,
          receivedQty: Math.min(row.qty, Math.max(0, row.receivedQty || 0) + (receivedByIndex.get(index) ?? 0)),
        }))
        po.status = po.rows.every((row) => (row.receivedQty || 0) >= row.qty) ? 'received' : 'ordered'
        po.note = (po.note ? po.note + ' · ' : '') + 'Phiếu nhập ' + gr.code
        const op = makeOp('po.upsert', null)
        po.hlc = op.hlc
        await dbx.purchaseOrders.put(po)
        op.payload = po
        await persistOp(op)
      },
    )
  })
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
    const total = Number.isFinite(g.total) ? Math.max(0, g.total) : 0
    const paid = Number.isFinite(g.paid) ? Math.max(0, Math.min(total, g.paid ?? 0)) : 0
    out.push({
      key: 'gr:' + g.id,
      kind: 'gr',
      code: g.code,
      supplierName: g.supplier,
      date: g.date,
      ts: g.ts,
      itemCount: g.rows.length,
      total,
      paid,
      debt: Math.max(0, total - paid),
      note: g.note,
    })
  }
  for (const po of pos) {
    if (po.status === 'received' || po.status === 'cancelled') continue
    const remainingRows = po.rows.map((row) => ({
      row,
      remain: Math.max(0, row.qty - (row.receivedQty || 0)),
    })).filter((item) => item.remain > 0)
    const remainingTotal = Math.round(remainingRows.reduce((sum, item) => sum + item.remain * item.row.cost, 0))
    out.push({
      key: 'po:' + po.id,
      kind: 'po',
      code: po.code,
      supplierName: po.supplierName,
      date: po.date,
      ts: po.ts,
      itemCount: remainingRows.length,
      total: remainingTotal,
      paid: 0,
      // PO chưa nhận không phải khoản phải trả; nợ chỉ phát sinh từ GoodsReceipt.
      debt: 0,
      note: po.note,
    })
  }
  out.sort((a, b) => b.ts - a.ts)
  return out
}
