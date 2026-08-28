/**
 * 3SU Next — Nhập hàng nâng cao (GR2)
 * Port từ 21-gr2.js, 22-gr2-ext.js, 23-gr2-seeding.js:
 * - Chọn NCC từ danh sách + thêm nhanh
 * - Picker chạm nhiều lần tăng SL (batch mode)
 * - HSD riêng từng dòng + quy đổi đơn vị (thùng/lốc…)
 * - Gợi ý giá bán + cảnh báo giá nhập tăng đột biến
 * - Thanh toán ngay / ghi nợ NCC
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, today, matchesSearch } from '@/core/format'
import { saveGoodsReceipt, suggestSellPrice, detectPriceSpike, lastPurchaseCost } from '@/core/domain/inventory'
import { createSupplier } from '@/core/domain/suppliers'
import { logError } from '@/core/errorLogger'
import { createConfirmGate } from '@/core/confirmGate'
import { Sheet, ConfirmDialog } from '@/shared/components'
import { useUnsavedDraftGuard } from '@/shared/useUnsavedDraftGuard'
import {
  DRAFT_RECEIPT, clearDraft, loadFreshDraft, persistReceiptDraft, type ReceiptDraft,
} from '@/core/domain/drafts'
import { ChevronLeft, Plus, Search, Trash2, AlertTriangle, ChevronDown, FileText } from 'lucide-react'
import type { Product, GoodsReceiptRow, Supplier, PriceLogEntry } from '@/core/types'

interface DraftRow extends GoodsReceiptRow {
  key: string
  /** Giá bán mới (0 = giữ nguyên) */
  sellPrice: number
}

export function GoodsReceiptPage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const [supplierId, setSupplierId] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [date, setDate] = useState(today())
  const [expiry, setExpiry] = useState('')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [confirmSave, setConfirmSave] = useState(false)
  const [saving, setSaving] = useState(false)
  const confirmGate = useRef(createConfirmGate())
  const [supPickerOpen, setSupPickerOpen] = useState(false)
  const [newSupOpen, setNewSupOpen] = useState(false)
  const [nsName, setNsName] = useState('')
  const [nsPhone, setNsPhone] = useState('')
  const [paid, setPaid] = useState(0)
  const [payMethod, setPayMethod] = useState<'cash' | 'transfer' | 'debt'>('cash')
  const draftReady = useRef(false)
  const leave = useUnsavedDraftGuard(rows.length > 0 || !!note.trim() || !!supplierName.trim())

  useEffect(() => {
    void loadFreshDraft<ReceiptDraft>(DRAFT_RECEIPT).then((d) => {
      draftReady.current = true
      if (!d) return
      setSupplierId(d.supplierId)
      setSupplierName(d.supplierName)
      setDate(d.date)
      setExpiry(d.expiry)
      setNote(d.note)
      setRows(d.rows as DraftRow[])
      setPaid(d.paid)
      setPayMethod(d.payMethod)
    })
  }, [])

  useEffect(() => {
    if (!draftReady.current) return
    const t = window.setTimeout(() => {
      void persistReceiptDraft({
        supplierId, supplierName, date, expiry, note, rows, paid, payMethod,
      })
    }, 400)
    return () => window.clearTimeout(t)
  }, [supplierId, supplierName, date, expiry, note, rows, paid, payMethod])

  const products = useLiveQuery(
    () => dbx.products.filter((p) => !p.deleted).toArray(),
    [],
    [] as Product[],
  )
  const suppliers = useLiveQuery(
    () => dbx.suppliers.filter((s) => !s.deleted).toArray(),
    [],
    [] as Supplier[],
  )
  const priceLogs = useLiveQuery(() => dbx.priceLog.toArray(), [], [] as PriceLogEntry[])

  const logsByProduct = useMemo(() => {
    const map: Record<string, PriceLogEntry[]> = {}
    priceLogs.forEach((l) => { (map[l.productId] ??= []).push(l) })
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.ts - b.ts))
    return map
  }, [priceLogs])

  const filtered = useMemo(
    () => products.filter((p) => matchesSearch(p.name + ' ' + p.cat + ' ' + p.barcode, query)),
    [products, query],
  )

  const total = rows.reduce((a, r) => a + r.qty * r.cost, 0)
  const selectedCount = rows.reduce((a, r) => a + r.qty, 0)

  /* Batch mode: chạm nhiều lần tăng SL (port 23-gr2-seeding addLine) */
  function addRow(p: Product) {
    setRows((rs) => {
      const ex = rs.find((r) => r.productId === p.id)
      if (ex) return rs.map((r) => (r.key === ex.key ? { ...r, qty: r.qty + 1 } : r))
      return [...rs, {
        key: p.id + '_' + Date.now(),
        productId: p.id,
        name: p.name,
        unit: p.unit,
        unitRatio: 1,
        qty: 1,
        cost: p.cost || 0,
        expiry: '',
        sellPrice: 0,
      }]
    })
  }

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key))
  }

  function pickSupplier(s: Supplier) {
    setSupplierId(s.id)
    setSupplierName(s.name)
    setSupPickerOpen(false)
  }

  async function addSupplier() {
    const nm = nsName.trim()
    if (!nm) { showToast('Cần tên nhà cung cấp', 'bad'); return }
    const s = await createSupplier({ name: nm, phone: nsPhone })
    pickSupplier(s)
    setNewSupOpen(false)
    setNsName('')
    setNsPhone('')
    showToast('✓ Đã thêm NCC ' + nm, 'ok')
  }

  async function handleSave() {
    if (rows.length === 0) { showToast('Thêm ít nhất 1 sản phẩm', 'bad'); return }
    const invalid = rows.find((r) => r.qty <= 0)
    if (invalid) { showToast('Số lượng phải > 0', 'bad'); return }
    if (!confirmGate.current.tryEnter()) return
    setSaving(true)
    try {
      const prices: Record<string, number> = {}
      rows.forEach((r) => { if (r.sellPrice > 0) prices[r.productId] = r.sellPrice })
      const gr = await saveGoodsReceipt({
        supplier: supplierName.trim() || 'NCC lẻ',
        supplierId: supplierId || undefined,
        date,
        expiry,
        note: note.trim(),
        rows: rows.map(({ key: _key, sellPrice: _sellPrice, ...r }) => r),
        paid,
        payMethod,
        prices,
      })
      showToast(`✓ Đã nhập kho ${fmt(gr.total)}`, 'ok')
      leave.allowLeave()
      await clearDraft(DRAFT_RECEIPT)
      navigate('/kho')
    } catch (e) {
      logError(e, 'goodsReceipt.save')
      showToast('Lỗi khi lưu phiếu nhập', 'bad')
    } finally {
      setSaving(false)
      setConfirmSave(false)
      confirmGate.current.leave()
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate('/kho')}>
          <ChevronLeft size={20} />
        </button>
        <div className="font-brand text-[17px] font-medium flex-1 text-center" style={{ color: 'var(--ink)' }}>
          Nhập hàng
        </div>
        <button className="btn-back" onClick={() => navigate('/nhap-hang/hoa-don')} aria-label="Nhập từ hoá đơn">
          <FileText size={18} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-40 max-w-[520px] mx-auto w-full">
        {/* Nhà cung cấp */}
        <button
          className="field-input flex items-center justify-between w-full text-left"
          onClick={() => setSupPickerOpen(true)}
        >
          <span style={{ color: supplierName ? 'var(--ink)' : 'var(--mute-2)' }}>
            {supplierName || 'Chọn nhà cung cấp…'}
          </span>
          <ChevronDown size={16} style={{ color: 'var(--mute)' }} />
        </button>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--mute)' }}>Ngày nhập</span>
            <input className="field-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--mute)' }}>HSD (chung)</span>
            <input className="field-input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </label>
        </div>

        {/* Danh sách dòng */}
        <div className="section-label mt-4">Sản phẩm nhập ({rows.length})</div>
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const prod = products.find((p) => p.id === r.productId)
            const advice = prod ? suggestSellPrice(r.cost, prod.price) : null
            const spike = detectPriceSpike(logsByProduct[r.productId] ?? [], r.cost)
            const oldCost = lastPurchaseCost(priceLogs, r.productId)
            const unitOpts = [{ n: prod?.unit || r.unit, r: 1 }, ...(prod?.units ?? [])]
            return (
              <div key={r.key} className="card p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>
                      {prod?.emoji ? prod.emoji + ' ' : ''}{r.name}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
                      Tồn: {prod?.stock ?? 0} {prod?.unit || r.unit}
                    </div>
                  </div>
                  <button onClick={() => removeRow(r.key)} aria-label="Xóa dòng" className="p-1">
                    <Trash2 size={15} style={{ color: 'var(--down)' }} />
                  </button>
                </div>

                {/* SL + đơn vị quy đổi */}
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px]" style={{ color: 'var(--mute)' }}>Số lượng</span>
                    <input
                      className="field-input !py-2 text-sm"
                      type="number" inputMode="numeric"
                      value={r.qty || ''}
                      onChange={(e) => updateRow(r.key, { qty: Number(e.target.value) || 0 })}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px]" style={{ color: 'var(--mute)' }}>Đơn vị tính</span>
                    <select
                      className="field-input !py-2 text-sm"
                      value={r.unitRatio}
                      onChange={(e) => {
                        const ratio = Number(e.target.value) || 1
                        const u = unitOpts.find((o) => o.r === ratio)
                        updateRow(r.key, { unitRatio: ratio, unit: u?.n || r.unit })
                      }}
                    >
                      {unitOpts.map((u) => (
                        <option key={u.n + u.r} value={u.r}>
                          {u.n}{u.r > 1 ? ` (= ${u.r} ${prod?.unit || ''})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Giá vốn + HSD riêng */}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px]" style={{ color: 'var(--mute)' }}>Giá vốn</span>
                    <input
                      className="field-input !py-2 text-sm"
                      type="number" inputMode="numeric"
                      value={r.cost || ''}
                      onChange={(e) => updateRow(r.key, { cost: Number(e.target.value) || 0 })}
                    />
                    {oldCost !== null && oldCost !== r.cost && (
                      <span className="text-[11px]" style={{ color: 'var(--mute)' }}>{fmt(oldCost)} → {fmt(r.cost)}</span>
                    )}
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px]" style={{ color: 'var(--mute)' }}>HSD (dòng này)</span>
                    <input
                      className="field-input !py-2 text-sm"
                      type="date"
                      value={r.expiry}
                      onChange={(e) => updateRow(r.key, { expiry: e.target.value })}
                    />
                  </label>
                </div>

                {/* Cảnh báo giá tăng đột biến */}
                {spike !== null && (
                  <div className="flex items-center gap-1.5 mt-2 text-[11.5px] px-2 py-1.5 rounded-lg"
                    style={{ background: 'color-mix(in srgb, var(--down) 12%, transparent)', color: 'var(--down)' }}>
                    <AlertTriangle size={13} />
                    Giá vốn cao hơn ~{spike}% so với trung bình các lần nhập trước
                  </div>
                )}

                {/* Giá bán mới + gợi ý */}
                <div className="flex items-end gap-2 mt-2">
                  <label className="flex flex-col gap-1 flex-1">
                    <span className="text-[11px]" style={{ color: 'var(--mute)' }}>Giá bán mới (để trống = giữ nguyên)</span>
                    <input
                      className="field-input !py-2 text-sm"
                      type="number" inputMode="numeric"
                      placeholder={prod ? String(prod.price) : ''}
                      value={r.sellPrice || ''}
                      onChange={(e) => updateRow(r.key, { sellPrice: Number(e.target.value) || 0 })}
                    />
                  </label>
                  {advice && (
                    <button
                      className="btn-ghost !py-2 text-[11.5px] whitespace-nowrap"
                      onClick={() => updateRow(r.key, { sellPrice: advice.price })}
                    >
                      Gợi ý {fmt(advice.price)} (+{advice.margin}%)
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between mt-2 text-[11.5px]">
                  <span style={{ color: 'var(--mute)' }}>
                    Thành tiền: <b style={{ color: 'var(--ink)' }}>{fmt(r.qty * r.cost)}</b>
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        <button className="btn-ghost w-full mt-3 flex items-center justify-center gap-2" onClick={() => setPickerOpen(true)}>
          <Plus size={16} /> Thêm sản phẩm
        </button>

        {/* Thanh toán */}
        <div className="section-label mt-5">Thanh toán</div>
        <div className="card p-3 flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {([['cash', 'Tiền mặt'], ['transfer', 'Chuyển khoản'], ['debt', 'Ghi nợ']] as const).map(([v, label]) => (
              <button
                key={v}
                className={'chip ' + (payMethod === v ? 'chip-on' : '')}
                onClick={() => setPayMethod(v)}
              >
                {label}
              </button>
            ))}
          </div>
          {payMethod !== 'debt' && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: 'var(--mute)' }}>Số tiền trả trước (0 = ghi nợ hết)</span>
              <input
                className="field-input !py-2 text-sm"
                type="number" inputMode="numeric"
                value={paid || ''}
                placeholder={String(Math.round(total))}
                onChange={(e) => setPaid(Number(e.target.value) || 0)}
              />
            </label>
          )}
        </div>

        <input className="field-input mt-4" placeholder="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {/* Thanh tổng + nút lưu */}
      <div className="absolute bottom-0 left-0 right-0 px-4 pt-3 pb-5"
        style={{ background: 'var(--paper)', borderTop: '0.5px solid var(--hair)' }}>
        <div className="max-w-[520px] mx-auto">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm" style={{ color: 'var(--mute)' }}>Tổng tiền nhập</span>
            <span className="stat-num text-xl font-medium" style={{ color: 'var(--ink)' }}>{fmt(total)}</span>
          </div>
          <button className="btn-cta" disabled={rows.length === 0 || saving} onClick={() => setConfirmSave(true)}>
            Lưu phiếu nhập
          </button>
        </div>
      </div>

      {/* Product picker sheet — batch mode */}
      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Thêm mặt hàng">
        <div className="text-[11.5px] mb-2 px-1" style={{ color: 'var(--mute)' }}>
          Chạm để thêm — chạm nhiều lần để tăng số lượng. Đã chọn <b style={{ color: 'var(--ink)' }}>{selectedCount}</b> món.
        </div>
        <div className="relative mb-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--mute-2)' }} />
          <input className="field-input pl-9 text-sm" placeholder="Tìm tên hoặc mã vạch…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </div>
        <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto">
          {filtered.map((p) => {
            const inRows = rows.find((r) => r.productId === p.id)
            return (
              <button key={p.id} className={'list-row ' + (inRows ? 'list-row-on' : '')} onClick={() => addRow(p)}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>
                    {p.emoji ? p.emoji + ' ' : ''}{p.name}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
                    Tồn {p.stock} {p.unit} · vốn {fmt(p.cost)}
                  </div>
                </div>
                {inRows
                  ? <span className="chip chip-on">×{inRows.qty}</span>
                  : <Plus size={16} style={{ color: 'var(--mute)' }} />}
              </button>
            )
          })}
          {filtered.length === 0 && (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--mute)' }}>
              {query ? 'Không khớp — thử từ khóa khác' : 'Kho trống — nạp 500 mặt hàng mẫu ở màn Kho hàng'}
            </div>
          )}
        </div>
        <button className="btn-cta mt-3" onClick={() => setPickerOpen(false)}>Xong</button>
      </Sheet>

      {/* Supplier picker sheet */}
      <Sheet open={supPickerOpen} onClose={() => setSupPickerOpen(false)} title="Chọn nhà cung cấp">
        <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto">
          <button className="list-row" onClick={() => { setSupplierId(''); setSupplierName(''); setSupPickerOpen(false) }}>
            <div className="flex-1 text-sm font-medium" style={{ color: 'var(--ink)' }}>NCC lẻ (không lưu công nợ)</div>
          </button>
          {suppliers.map((s) => (
            <button key={s.id} className={'list-row ' + (supplierId === s.id ? 'list-row-on' : '')} onClick={() => pickSupplier(s)}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{s.name}</div>
                {s.phone && <div className="text-[11px]" style={{ color: 'var(--mute)' }}>{s.phone}</div>}
              </div>
            </button>
          ))}
        </div>
        <button className="btn-ghost w-full mt-3 flex items-center justify-center gap-2" onClick={() => { setSupPickerOpen(false); setNewSupOpen(true) }}>
          <Plus size={16} /> Thêm NCC mới
        </button>
      </Sheet>

      {/* New supplier sheet */}
      <Sheet open={newSupOpen} onClose={() => setNewSupOpen(false)} title="Thêm nhà cung cấp">
        <div className="flex flex-col gap-3">
          <input className="field-input" placeholder="Tên nhà cung cấp *" value={nsName} onChange={(e) => setNsName(e.target.value)} autoFocus />
          <input className="field-input" placeholder="Số điện thoại" type="tel" value={nsPhone} onChange={(e) => setNsPhone(e.target.value)} />
          <button className="btn-cta" onClick={addSupplier}>Thêm NCC</button>
        </div>
      </Sheet>

      {leave.dialog}
      <ConfirmDialog
        open={confirmSave}
        title="Lưu phiếu nhập?"
        message={`Nhập ${rows.length} sản phẩm, tổng ${fmt(total)}${supplierName ? ' từ ' + supplierName : ''}. Giá vốn cập nhật theo bình quân gia quyền. Phiếu không sửa/hủy được — sai thì vào Kiểm kê hoặc sửa tồn trên sản phẩm.`}
        confirmLabel="Lưu"
        onConfirm={handleSave}
        onCancel={() => setConfirmSave(false)}
      />
    </div>
  )
}
