/**
 * 3SU Next — Đơn mua hàng (Purchase Orders)
 * Port từ 26-purchase-orders.js: gom phiếu nhập + PO, tạo đơn, nhận hàng vào kho.
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, fmtShort, today, matchesSearch } from '@/core/format'
import { logError } from '@/core/errorLogger'
import {
  createPurchaseOrder, receivePurchaseOrder, updatePurchaseOrderStatus,
  aggregatePurchases, PO_STATUS_LABEL,
} from '@/core/domain/purchase'
import { Sheet, ConfirmDialog, EmptyState } from '@/shared/components'
import { ChevronLeft, Plus, Search, Trash2, PackageCheck } from 'lucide-react'
import type { Product, Supplier, PurchaseOrder, PurchaseOrderRow } from '@/core/types'

interface DraftRow extends Omit<PurchaseOrderRow, 'receivedQty'> {
  key: string
}

const STATUS_COLOR: Record<PurchaseOrder['status'], string> = {
  draft: 'var(--mute)',
  ordered: 'var(--gold)',
  received: 'var(--up)',
  cancelled: 'var(--down)',
}

export function PurchaseOrdersPage() {
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

  const pendingCount = useMemo(
    () => pos.filter((p) => p.status === 'ordered').length,
    [pos],
  )

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
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate('/them')}>
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 text-center">
          <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Đơn mua hàng</div>
          <div className="text-[11px]" style={{ color: 'var(--mute)' }}>{pendingCount} đơn chờ nhập</div>
        </div>
        <button className="btn-back" onClick={() => setShowCreate(true)} aria-label="Tạo đơn">
          <Plus size={18} />
        </button>
      </header>

      <div className="px-4 pt-3 pb-2 flex flex-col gap-2">
        <div className="flex gap-2">
          <button className="chip flex-1 justify-center" style={tab === 'all' ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : {}} onClick={() => setTab('all')}>Tất cả</button>
          <button className="chip flex-1 justify-center" style={tab === 'pending' ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : {}} onClick={() => setTab('pending')}>Chờ nhập</button>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--mute-2)' }} />
          <input className="field-input pl-9 text-sm" placeholder="Tìm mã đơn, NCC…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {rows.map((r) => {
          const po = r.kind === 'po' ? pos.find((p) => p.id === r.key.slice(3)) : null
          return (
            <div key={r.key} className="list-row">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{r.code}</span>
                  {po && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ color: STATUS_COLOR[po.status], background: 'var(--paper-2)' }}>
                      {PO_STATUS_LABEL[po.status]}
                    </span>
                  )}
                  {r.kind === 'gr' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ color: 'var(--up)', background: 'var(--paper-2)' }}>Đã nhập</span>
                  )}
                </div>
                <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
                  {r.supplierName || '—'} · {r.itemCount} mặt hàng · {r.date}
                </div>
              </div>
              <div className="text-right flex items-center gap-2">
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{fmtShort(r.total)}đ</div>
                  {r.debt > 0 && <div className="text-[10px]" style={{ color: 'var(--down)' }}>nợ {fmtShort(r.debt)}đ</div>}
                </div>
                {po && po.status === 'ordered' && (
                  <div className="flex flex-col gap-1">
                    <button className="p-1.5" onClick={() => setReceiveTarget(po)} aria-label="Nhận hàng" style={{ color: 'var(--up)' }}>
                      <PackageCheck size={16} />
                    </button>
                    <button className="p-1.5" onClick={() => setCancelTarget(po)} aria-label="Hủy" style={{ color: 'var(--mute-2)' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {rows.length === 0 && <EmptyState icon="📦" title="Chưa có đơn mua hàng" sub="Bấm + để tạo đơn đặt hàng nhà cung cấp" />}
      </div>

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

/* ─── Tạo đơn mua hàng ─── */
function CreatePoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const showToast = useApp((s) => s.showToast)
  const [supplierId, setSupplierId] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')

  const suppliers = useLiveQuery(() => dbx.suppliers.filter((s) => !s.deleted).toArray(), [], [] as Supplier[])
  const products = useLiveQuery(() => dbx.products.filter((p) => !p.deleted).toArray(), [], [] as Product[])
  const filtered = useMemo(() => products.filter((p) => matchesSearch(p.name + ' ' + p.cat, query)), [products, query])

  const total = rows.reduce((a, r) => a + r.qty * r.cost, 0)
  const supplier = suppliers.find((s) => s.id === supplierId)

  function addRow(p: Product) {
    setRows((rs) => {
      if (rs.some((r) => r.productId === p.id)) { showToast('Đã có trong đơn', 'bad'); return rs }
      const key = p.id + '_' + Date.now()
      return [...rs, {
        key,
        lineId: key,
        productId: p.id,
        name: p.name,
        unit: p.unit,
        unitRatio: 1,
        qty: 1,
        cost: p.cost || 0,
      }]
    })
    setPickerOpen(false)
    setQuery('')
  }

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  async function handleCreate() {
    if (!supplier) { showToast('Chọn nhà cung cấp', 'bad'); return }
    if (!rows.length) { showToast('Thêm ít nhất 1 mặt hàng', 'bad'); return }
    try {
      const po = await createPurchaseOrder({
        supplierId: supplier.id,
        supplierName: supplier.name,
        rows: rows.map(({ key: _key, ...r }) => r),
        note,
        date: today(),
      })
      showToast(`✓ Đã tạo ${po.code}`, 'ok')
      setRows([]); setNote(''); setSupplierId('')
      onClose()
    } catch (e) {
      logError(e, 'po.create')
      showToast(e instanceof Error ? e.message : 'Lỗi khi tạo', 'bad')
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Tạo đơn mua hàng">
      <div className="flex flex-col gap-3">
        <select className="field-input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">— Chọn nhà cung cấp —</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <div className="section-label">Mặt hàng ({rows.length})</div>
        <div className="flex flex-col gap-2 max-h-[36vh] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.key} className="card p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{r.name}</span>
                <button onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Xóa">
                  <Trash2 size={14} style={{ color: 'var(--down)' }} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className="field-input !py-2 text-sm" type="number" inputMode="numeric" placeholder="SL" value={r.qty || ''} onChange={(e) => updateRow(r.key, { qty: Number(e.target.value) || 0 })} />
                <input className="field-input !py-2 text-sm" type="number" inputMode="numeric" placeholder="Giá vốn" value={r.cost || ''} onChange={(e) => updateRow(r.key, { cost: Number(e.target.value) || 0 })} />
              </div>
            </div>
          ))}
        </div>
        <button className="btn-ghost flex items-center justify-center gap-2" onClick={() => setPickerOpen(true)}>
          <Plus size={16} /> Thêm mặt hàng
        </button>
        <input className="field-input" placeholder="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />

        <div className="flex items-center justify-between pt-1">
          <span className="text-sm" style={{ color: 'var(--mute)' }}>Tổng</span>
          <span className="stat-num text-lg font-medium" style={{ color: 'var(--ink)' }}>{fmt(total)}</span>
        </div>
        <button className="btn-cta" onClick={handleCreate}>Tạo đơn đặt hàng</button>
      </div>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Chọn sản phẩm">
        <div className="relative mb-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--mute-2)' }} />
          <input className="field-input pl-9 text-sm" placeholder="Tìm sản phẩm…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </div>
        <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto">
          {filtered.map((p) => (
            <button key={p.id} className="list-row" onClick={() => addRow(p)}>
              <div className="flex-1 min-w-0 text-left">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{p.name}</div>
                <div className="text-[11px]" style={{ color: 'var(--mute)' }}>vốn {fmt(p.cost)}</div>
              </div>
              <Plus size={16} style={{ color: 'var(--mute)' }} />
            </button>
          ))}
          {filtered.length === 0 && <div className="text-center py-8 text-sm" style={{ color: 'var(--mute)' }}>Không tìm thấy</div>}
        </div>
      </Sheet>
    </Sheet>
  )
}

function receiveRowKey(row: PurchaseOrderRow, index: number): string {
  return row.lineId || `${row.productId}#${index}`
}

/* ─── Nhận hàng vào kho ─── */
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
    <Sheet open onClose={onClose} title={`Nhận hàng — ${po.code}`}>
      <div className="flex flex-col gap-3">
        <div className="card p-3 max-h-[28vh] overflow-y-auto">
          {po.rows.map((r, index) => {
            const key = receiveRowKey(r, index)
            return (
              <div key={key} className="flex items-center justify-between text-sm py-1 gap-2" style={{ borderBottom: '0.5px solid var(--hair-2)' }}>
                <span className="flex-1" style={{ color: 'var(--ink-2)' }}>{r.name} <span style={{ color: 'var(--mute)' }}>({r.receivedQty || 0}/{r.qty} {r.unit})</span></span>
                <input
                  className="field-input !w-16 !py-1"
                  type="number"
                  value={qtys[key] ?? 0}
                  onChange={(e) => setQtys((q) => ({ ...q, [key]: Number(e.target.value) || 0 }))}
                />
              </div>
            )
          })}
          <div className="flex justify-between text-sm font-medium pt-2">
            <span style={{ color: 'var(--ink)' }}>Giá trị nhận lần này</span>
            <span style={{ color: 'var(--ink)' }}>{fmt(receiveTotal)}</span>
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs" style={{ color: 'var(--mute)' }}>HSD (chung, tùy chọn)</span>
          <input className="field-input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </label>

        <div className="flex gap-2">
          {(['debt', 'cash', 'transfer'] as const).map((m) => (
            <button key={m} className="chip flex-1 justify-center" style={payMethod === m ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : {}} onClick={() => setPayMethod(m)}>
              {m === 'debt' ? 'Công nợ' : m === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}
            </button>
          ))}
        </div>

        {payMethod !== 'debt' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: 'var(--mute)' }}>Số tiền đã trả (0 = ghi nợ hết)</span>
            <input className="field-input text-center" type="number" inputMode="numeric" value={paid || ''} placeholder="0" onChange={(e) => setPaid(Number(e.target.value) || 0)} />
            <div className="flex gap-2">
              <button className="chip flex-1 justify-center" onClick={() => setPaid(receiveTotal)}>Trả đủ</button>
              <button className="chip flex-1 justify-center" onClick={() => setPaid(0)}>Chưa trả</button>
            </div>
          </div>
        )}

        <button className="btn-cta" disabled={busy} onClick={handleReceive}>Xác nhận nhập kho</button>
      </div>
    </Sheet>
  )
}
