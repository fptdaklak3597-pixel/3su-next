/**
 * Đơn mua hàng web — tạo, nhận vào kho, hủy.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, matchesSearch, today } from '@/core/format'
import { logError } from '@/core/errorLogger'
import {
  aggregatePurchases, createPurchaseOrder, PO_STATUS_LABEL,
  receivePurchaseOrder, updatePurchaseOrderStatus,
} from '@/core/domain/purchase'
import { ConfirmDialog, Sheet } from '@/shared/components'
import { useUnsavedDraftGuard } from '@/shared/useUnsavedDraftGuard'
import { DRAFT_PO, clearDraft, loadFreshDraft, persistPoDraft, type PoDraft } from '@/core/domain/drafts'
import { WebEmpty } from '@/web/components/WebEmpty'
import type { Product, PurchaseOrder, PurchaseOrderRow, Supplier } from '@/core/types'

interface DraftRow extends Omit<PurchaseOrderRow, 'receivedQty'> { key: string }

export function WebPurchaseOrdersPage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const [tab, setTab] = useState<'all' | 'pending'>('all')
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null)
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrder | null>(null)

  const receipts = useLiveQuery(() => dbx.goodsReceipts.toArray(), [], [])
  const pos = useLiveQuery(() => dbx.purchaseOrders.toArray(), [], [] as PurchaseOrder[])

  const rows = useMemo(() => {
    let list = aggregatePurchases(receipts, pos)
    if (tab === 'pending') list = list.filter((r) => r.kind === 'po')
    if (query.trim()) list = list.filter((r) => matchesSearch(r.code + ' ' + r.supplierName, query))
    return list
  }, [receipts, pos, tab, query])

  const pendingCount = pos.filter((p) => p.status === 'ordered').length

  async function handleCancel() {
    if (!cancelTarget) return
    try {
      await updatePurchaseOrderStatus(cancelTarget.id, 'cancelled')
      showToast('Đã hủy đơn', 'ok')
      setCancelTarget(null)
    } catch (e) {
      logError(e, 'po.cancel')
      showToast(e instanceof Error ? e.message : 'Lỗi khi hủy', 'bad')
    }
  }

  return (
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>Đơn mua hàng</h2>
          <p>{pendingCount} đơn chờ nhập</p>
        </div>
        <button className="web-btn pri" onClick={() => setShowCreate(true)}>+ Tạo đơn</button>
      </div>

      <div className="web-chips">
        <button className={`web-chip ${tab === 'all' ? 'on' : ''}`} onClick={() => setTab('all')}>Tất cả</button>
        <button className={`web-chip ${tab === 'pending' ? 'on' : ''}`} onClick={() => setTab('pending')}>Chờ nhập</button>
      </div>
      <input className="web-search mb-3" style={{ paddingLeft: 12 }} placeholder="Tìm mã đơn, NCC…" value={query} onChange={(e) => setQuery(e.target.value)} />

      {rows.length === 0 ? (
        <WebEmpty title="Chưa có đơn mua" sub="Đặt hàng NCC rồi nhận vào kho khi hàng về.">
          <button className="web-btn pri" onClick={() => setShowCreate(true)}>+ Tạo đơn</button>
          <button className="web-btn" onClick={() => navigate('/nhap-hang')}>Nhập thẳng</button>
        </WebEmpty>
      ) : (
        <div className="web-table-wrap">
          <table className="web-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>NCC</th>
                <th>Ngày</th>
                <th>Tổng</th>
                <th>Trạng thái</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const po = r.kind === 'po' ? pos.find((p) => p.id === r.key.slice(3)) : null
                return (
                  <tr key={r.key} className="static">
                    <td>{r.code}</td>
                    <td>{r.supplierName || '—'}</td>
                    <td>{r.date}</td>
                    <td>{fmt(r.total)}{r.debt > 0 ? ` · nợ ${fmt(r.debt)}` : ''}</td>
                    <td>
                      {po
                        ? <span className={`web-badge ${po.status === 'received' ? 'ok' : po.status === 'cancelled' ? 'out' : 'low'}`}>{PO_STATUS_LABEL[po.status]}</span>
                        : <span className="web-badge ok">Đã nhập</span>}
                    </td>
                    <td>
                      {po?.status === 'ordered' && (
                        <>
                          <button className="web-btn pri" style={{ height: 28 }} onClick={() => setReceiveTarget(po)}>Nhận hàng</button>
                          {' '}
                          <button className="web-btn" style={{ height: 28 }} onClick={() => setCancelTarget(po)}>Hủy</button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreatePoSheet open={showCreate} onClose={() => setShowCreate(false)} />
      {receiveTarget && <ReceiveSheet po={receiveTarget} onClose={() => setReceiveTarget(null)} />}
      <ConfirmDialog
        open={!!cancelTarget}
        title="Hủy đơn mua hàng?"
        message={`Hủy đơn ${cancelTarget?.code}? Đơn sẽ không thể nhập kho nữa.`}
        confirmLabel="Hủy đơn"
        danger
        onConfirm={handleCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  )
}

function CreatePoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const showToast = useApp((s) => s.showToast)
  const [supplierId, setSupplierId] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([])
  const [note, setNote] = useState('')
  const [query, setQuery] = useState('')
  const draftReady = useRef(false)
  const dirty = rows.length > 0 || !!note.trim() || !!supplierId
  const leave = useUnsavedDraftGuard(open && dirty)

  const suppliers = useLiveQuery(() => dbx.suppliers.filter((s) => !s.deleted).toArray(), [], [] as Supplier[])
  const products = useLiveQuery(() => dbx.products.filter((p) => !p.deleted).toArray(), [], [] as Product[])
  const filtered = useMemo(() => products.filter((p) => matchesSearch(p.name + ' ' + p.cat, query)), [products, query])
  const total = rows.reduce((a, r) => a + r.qty * r.cost, 0)
  const supplier = suppliers.find((s) => s.id === supplierId)

  useEffect(() => {
    if (!open) { draftReady.current = false; return }
    void loadFreshDraft<PoDraft>(DRAFT_PO).then((d) => {
      if (!d) { draftReady.current = true; return }
      setSupplierId(d.supplierId)
      setRows((d.rows || []) as DraftRow[])
      setNote(d.note)
      draftReady.current = true
    }).catch(() => { draftReady.current = true })
  }, [open])

  useEffect(() => {
    if (!open || !draftReady.current) return
    const tmr = window.setTimeout(() => {
      void persistPoDraft({
        supplierId,
        supplierName: supplier?.name || '',
        rows,
        note,
      })
    }, 400)
    return () => window.clearTimeout(tmr)
  }, [open, supplierId, rows, note, supplier?.name])

  async function handleCreate() {
    if (!supplier) { showToast('Chọn nhà cung cấp', 'bad'); return }
    if (!rows.length) { showToast('Thêm ít nhất 1 mặt hàng', 'bad'); return }
    try {
      const po = await createPurchaseOrder({
        supplierId: supplier.id,
        supplierName: supplier.name,
        rows: rows.map(({ key: _k, ...r }) => r),
        note,
        date: today(),
      })
      showToast(`✓ Đã tạo ${po.code}`, 'ok')
      leave.allowLeave()
      await clearDraft(DRAFT_PO)
      setRows([])
      setNote('')
      setSupplierId('')
      onClose()
    } catch (e) {
      logError(e, 'po.create')
      showToast(e instanceof Error ? e.message : 'Lỗi khi tạo', 'bad')
    }
  }

  return (
    <>
    {leave.dialog}
    <Sheet open={open} onClose={onClose} title="Tạo đơn mua hàng">
      <select className="web-input mb-2" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
        <option value="">— Chọn nhà cung cấp —</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <input className="web-input mb-2" placeholder="Tìm hàng để thêm…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="max-h-[20vh] overflow-y-auto mb-2">
        {query && filtered.slice(0, 8).map((p) => (
          <button key={p.id} className="list-row" onClick={() => {
            const key = p.id + '_' + Date.now()
            setRows((rs) => rs.some((r) => r.productId === p.id) ? rs : [...rs, {
              key,
              lineId: key,
              productId: p.id,
              name: p.name,
              unit: p.unit,
              unitRatio: 1,
              qty: 1,
              cost: p.cost || 0,
            }])
            setQuery('')
          }}>
            <span className="text-sm">{p.name}</span>
          </button>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.key} className="flex gap-2 mb-2">
          <span className="flex-1 text-sm">{r.name}</span>
          <input className="web-input !py-1 w-16" type="number" value={r.qty || ''} onChange={(e) => setRows((rs) => rs.map((x) => x.key === r.key ? { ...x, qty: Number(e.target.value) || 0 } : x))} />
          <input className="web-input !py-1 w-24" type="number" value={r.cost || ''} onChange={(e) => setRows((rs) => rs.map((x) => x.key === r.key ? { ...x, cost: Number(e.target.value) || 0 } : x))} />
          <button className="web-btn" style={{ height: 28 }} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Xóa</button>
        </div>
      ))}
      <input className="web-input mb-2" placeholder="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex justify-between text-sm mb-2"><span>Tổng</span><b>{fmt(total)}</b></div>
      <button className="web-btn pri w-full" onClick={handleCreate}>Tạo đơn</button>
    </Sheet>
    </>
  )
}

function receiveRowKey(row: PurchaseOrderRow, index: number): string {
  return row.lineId || `${row.productId}#${index}`
}

function ReceiveSheet({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const [paid, setPaid] = useState(0)
  const [payMethod, setPayMethod] = useState<'cash' | 'transfer' | 'debt'>('debt')
  const [expiry, setExpiry] = useState('')
  const [busy, setBusy] = useState(false)
  const [qtys, setQtys] = useState<Record<string, number>>(() =>
    Object.fromEntries(po.rows.map((r, index) => [receiveRowKey(r, index), Math.max(0, r.qty - (r.receivedQty || 0))])),
  )
  const receiveTotal = po.rows.reduce((sum, row, index) => {
    const qty = qtys[receiveRowKey(row, index)] ?? 0
    return sum + Math.max(0, qty) * row.cost
  }, 0)

  async function handleReceive() {
    setBusy(true)
    try {
      await receivePurchaseOrder(po.id, { paid, payMethod, expiry, qtys })
      showToast(`✓ Đã nhập kho ${po.code}`, 'ok')
      onClose()
      navigate('/kho')
    } catch (e) {
      logError(e, 'po.receive')
      showToast(e instanceof Error ? e.message : 'Lỗi khi nhập', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Nhận hàng · ${po.code}`}>
      {po.rows.map((r, index) => {
        const key = receiveRowKey(r, index)
        return (
          <div key={key} className="flex items-center justify-between text-sm py-1 gap-2">
            <span className="flex-1">{r.name} <span className="web-sub">đã nhận {r.receivedQty || 0}/{r.qty} {r.unit}</span></span>
            <input
              className="web-input !py-1 w-16"
              type="number"
              value={qtys[key] ?? 0}
              onChange={(e) => setQtys((q) => ({ ...q, [key]: Number(e.target.value) || 0 }))}
            />
          </div>
        )
      })}
      <div className="flex justify-between text-sm font-medium py-2"><span>Giá trị nhận lần này</span><span>{fmt(receiveTotal)}</span></div>
      <input className="web-input mb-2" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      <div className="web-chips">
        {(['debt', 'cash', 'transfer'] as const).map((m) => (
          <button key={m} className={`web-chip ${payMethod === m ? 'on' : ''}`} onClick={() => setPayMethod(m)}>
            {m === 'debt' ? 'Công nợ' : m === 'cash' ? 'Tiền mặt' : 'CK'}
          </button>
        ))}
      </div>
      {payMethod !== 'debt' && (
        <>
          <input className="web-input mb-2" type="number" placeholder="Số đã trả (0 = ghi nợ hết)" value={paid || ''} onChange={(e) => setPaid(Number(e.target.value) || 0)} />
          <div className="web-chips">
            <button className="web-chip" onClick={() => setPaid(receiveTotal)}>Trả đủ</button>
            <button className="web-chip" onClick={() => setPaid(0)}>Chưa trả</button>
          </div>
        </>
      )}
      <button className="web-btn pri w-full" disabled={busy} onClick={handleReceive}>Xác nhận nhập kho</button>
    </Sheet>
  )
}
