/**
 * Nhập hàng web — bảng dòng + chọn NCC + lưu phiếu.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, matchesSearch, today } from '@/core/format'
import { detectPriceSpike, lastPurchaseCost, saveGoodsReceipt, suggestSellPrice } from '@/core/domain/inventory'
import { attachHidBarcode } from '@/core/browser/hidBarcode'
import { createSupplier } from '@/core/domain/suppliers'
import { logError } from '@/core/errorLogger'
import { createConfirmGate } from '@/core/confirmGate'
import { ConfirmDialog, Sheet } from '@/shared/components'
import { useUnsavedDraftGuard } from '@/shared/useUnsavedDraftGuard'
import {
  DRAFT_RECEIPT, clearDraft, loadFreshDraft, persistReceiptDraft, type ReceiptDraft,
} from '@/core/domain/drafts'
import { WebDateRange } from '@/web/components/WebDateRange'
import type { GoodsReceiptRow, PriceLogEntry, Product, Supplier } from '@/core/types'

interface DraftRow extends GoodsReceiptRow {
  key: string
  sellPrice: number
}

export function WebGoodsReceiptPage() {
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

  const products = useLiveQuery(() => dbx.products.filter((p) => !p.deleted).toArray(), [], [] as Product[])
  const suppliers = useLiveQuery(() => dbx.suppliers.filter((s) => !s.deleted).toArray(), [], [] as Supplier[])
  const priceLogs = useLiveQuery(() => dbx.priceLog.toArray(), [], [] as PriceLogEntry[])

  const logsByProduct = useMemo(() => {
    const map: Record<string, PriceLogEntry[]> = {}
    priceLogs.forEach((l) => { (map[l.productId] ??= []).push(l) })
    return map
  }, [priceLogs])

  const filtered = useMemo(
    () => products.filter((p) => matchesSearch(p.name + ' ' + p.cat + ' ' + p.barcode, query)),
    [products, query],
  )
  const total = rows.reduce((a, r) => a + r.qty * r.cost, 0)

  useEffect(() => attachHidBarcode((code) => {
    const p = products.find((x) => x.barcode && x.barcode === code)
    if (!p) { showToast('Không thấy mã ' + code, 'bad'); return }
    addRow(p)
    showToast('Đã thêm ' + p.name, 'ok')
  }), [products, showToast])

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

  async function addSupplier() {
    const nm = nsName.trim()
    if (!nm) { showToast('Cần tên nhà cung cấp', 'bad'); return }
    const s = await createSupplier({ name: nm, phone: nsPhone })
    setSupplierId(s.id)
    setSupplierName(s.name)
    setNewSupOpen(false)
    setNsName('')
    setNsPhone('')
    showToast('✓ Đã thêm NCC ' + nm, 'ok')
  }

  async function handleSave() {
    if (rows.length === 0) { showToast('Thêm ít nhất 1 sản phẩm', 'bad'); return }
    if (rows.some((r) => r.qty <= 0)) { showToast('Số lượng phải > 0', 'bad'); return }
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
        rows: rows.map(({ key: _k, sellPrice: _s, ...r }) => r),
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
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>Nhập hàng</h2>
          <p>{rows.length} mặt hàng · {fmt(total)}</p>
        </div>
        <div className="web-ph-actions">
          <button type="button" className="web-btn" onClick={() => navigate('/nhap-hang/hoa-don')}>Nhập từ hoá đơn</button>
          <button type="button" className="web-btn" onClick={() => setPickerOpen(true)}>+ Thêm hàng</button>
          <button type="button" className="web-btn pri" disabled={rows.length === 0 || saving} onClick={() => setConfirmSave(true)}>
            Lưu phiếu
          </button>
        </div>
      </div>

      <div className="web-chips">
        {([['cash', 'Tiền mặt'], ['transfer', 'CK'], ['debt', 'Ghi nợ']] as const).map(([v, l]) => (
          <button type="button" key={v} className={`web-chip ${payMethod === v ? 'on' : ''}`} onClick={() => setPayMethod(v)}>{l}</button>
        ))}
      </div>

      <div className="web-order-bar">
        <select
          className="web-search"
          style={{ paddingLeft: 12 }}
          value={supplierId}
          onChange={(e) => {
            const id = e.target.value
            if (id === '__new') { setNewSupOpen(true); return }
            const s = suppliers.find((x) => x.id === id)
            setSupplierId(id)
            setSupplierName(s?.name || '')
          }}
        >
          <option value="">Không ghi công nợ</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="__new">+ Nhà cung cấp mới</option>
        </select>
        <WebDateRange
          from={date}
          to={date}
          single
          placeholder="Ngày nhập"
          onChange={(a) => { if (a) setDate(a) }}
        />
        <WebDateRange
          from={expiry}
          to={expiry}
          single
          placeholder="HSD chung"
          onChange={(a) => setExpiry(a)}
        />
        {payMethod !== 'debt' && (
          <input
            className="web-search"
            style={{ paddingLeft: 12, maxWidth: 160, flex: '0 0 160px' }}
            type="number"
            value={paid || ''}
            placeholder={total ? `Đã trả ${fmt(total)}` : 'Đã trả'}
            onChange={(e) => setPaid(Number(e.target.value) || 0)}
          />
        )}
        <input
          className="web-search"
          style={{ paddingLeft: 12 }}
          placeholder="Ghi chú"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="web-table-wrap">
        <table className="web-table">
          <thead>
            <tr>
              <th>Tên</th>
              <th>SL</th>
              <th>Đơn vị</th>
              <th>Giá vốn</th>
              <th>HSD</th>
              <th>Giá bán</th>
              <th>Thành tiền</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const prod = products.find((p) => p.id === r.productId)
              const advice = prod ? suggestSellPrice(r.cost, prod.price) : null
              const spike = detectPriceSpike(logsByProduct[r.productId] ?? [], r.cost)
              const oldCost = lastPurchaseCost(priceLogs, r.productId)
              const unitOpts = [{ n: prod?.unit || r.unit, r: 1 }, ...(prod?.units ?? [])]
              return (
                <tr key={r.key} className="static">
                  <td>
                    {r.name}
                    {spike !== null && <span className="web-badge out ml-2">Vốn +{spike}%</span>}
                  </td>
                  <td>
                    <input className="web-input web-gr-qty" type="number" value={r.qty || ''} onChange={(e) => updateRow(r.key, { qty: Number(e.target.value) || 0 })} />
                  </td>
                  <td>
                    <select
                      className="web-input web-gr-unit"
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
                  </td>
                  <td>
                    <input className="web-input web-gr-money" type="number" value={r.cost || ''} onChange={(e) => updateRow(r.key, { cost: Number(e.target.value) || 0 })} />
                    {oldCost !== null && oldCost !== r.cost && (
                      <div className="web-sub">{fmt(oldCost)} → {fmt(r.cost)}</div>
                    )}
                  </td>
                  <td>
                    <WebDateRange
                      from={r.expiry}
                      to={r.expiry}
                      single
                      placeholder="HSD"
                      onChange={(a) => updateRow(r.key, { expiry: a })}
                    />
                  </td>
                  <td>
                    <div className="web-gr-sell">
                      <input
                        className="web-input web-gr-money"
                        type="number"
                        placeholder={prod ? String(prod.price) : ''}
                        value={r.sellPrice || ''}
                        onChange={(e) => updateRow(r.key, { sellPrice: Number(e.target.value) || 0 })}
                      />
                      {advice && (
                        <button type="button" className="web-btn" style={{ height: 28 }} onClick={() => updateRow(r.key, { sellPrice: advice.price })}>
                          {fmt(advice.price)}
                        </button>
                      )}
                    </div>
                  </td>
                  <td>{fmt(r.qty * r.cost)}</td>
                  <td>
                    <button type="button" className="web-btn" style={{ height: 28 }} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Xóa</button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="web-table-empty">Chưa có hàng</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Thêm mặt hàng">
        <input className="web-input mb-2" placeholder="Tìm tên hoặc mã…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto">
          {filtered.map((p) => {
            const inRows = rows.find((r) => r.productId === p.id)
            return (
              <button key={p.id} className="list-row" onClick={() => addRow(p)}>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-[11px]" style={{ color: 'var(--kv-muted)' }}>Tồn {p.stock} · vốn {fmt(p.cost)}</div>
                </div>
                {inRows ? <span className="web-badge low">×{inRows.qty}</span> : null}
              </button>
            )
          })}
          {filtered.length === 0 && <div className="text-center py-8 text-sm" style={{ color: 'var(--kv-muted)' }}>Kho trống hoặc không khớp</div>}
        </div>
        <button className="web-btn pri w-full mt-3" onClick={() => setPickerOpen(false)}>Xong</button>
      </Sheet>

      <Sheet open={newSupOpen} onClose={() => setNewSupOpen(false)} title="Thêm nhà cung cấp">
        <div className="flex flex-col gap-2">
          <input className="web-input" placeholder="Tên *" value={nsName} onChange={(e) => setNsName(e.target.value)} />
          <input className="web-input" placeholder="SĐT" value={nsPhone} onChange={(e) => setNsPhone(e.target.value)} />
          <button className="web-btn pri" onClick={addSupplier}>Thêm</button>
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
