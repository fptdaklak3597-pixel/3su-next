/**
 * 3SU Next — Nhập hàng từ hoá đơn (UI)
 * Port từ 24-invoice-import.js: chọn file hoá đơn (XML/HTML/CSV/Excel/PDF/ảnh),
 * parse tự động → preview sửa → khớp sản phẩm trong kho → lưu phiếu nhập.
 */
import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, today, normalizeVi, uid } from '@/core/format'
import { parseInvoiceFile, type ParsedInvoice, type ParsedItem } from '@/core/domain/invoiceImport'
import { fileToBase64, scanInvoiceImages } from '@/core/ai/client'
import { parseGeminiInvoiceJson } from '@/core/ai/invoiceScan'
import { apiBase } from '@/core/sync/cloud'
import { invoiceLoaders } from '@/core/browser/invoiceLoaders'
import { saveGoodsReceipt } from '@/core/domain/inventory'
import { addProduct } from '@/core/domain/inventory'
import { createSupplier } from '@/core/domain/suppliers'
import { logError } from '@/core/errorLogger'
import { ConfirmDialog } from '@/shared/components'
import { ChevronLeft, Upload, FileText, Trash2, Link2, Plus } from 'lucide-react'
import type { Product, Supplier } from '@/core/types'

interface EditRow extends ParsedItem {
  key: string
  /** productId đã khớp ('' = tạo mới) */
  matchId: string
}

/** Điểm khớp tên (0..1) giữa tên hoá đơn và sản phẩm — fold tiếng Việt + token overlap. */
function matchScore(a: string, b: string): number {
  const na = normalizeVi(a).split(/\s+/).filter(Boolean)
  const nb = new Set(normalizeVi(b).split(/\s+/).filter(Boolean))
  if (!na.length || !nb.size) return 0
  let hit = 0
  na.forEach((t) => { if (nb.has(t)) hit++ })
  return hit / Math.max(na.length, nb.size)
}

export function InvoiceImportPage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const fileRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [inv, setInv] = useState<ParsedInvoice | null>(null)
  const [rows, setRows] = useState<EditRow[]>([])
  const [supName, setSupName] = useState('')
  const [supId, setSupId] = useState('')
  const [date, setDate] = useState(today())
  const [confirmSave, setConfirmSave] = useState(false)
  const [saving, setSaving] = useState(false)

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

  /** Tự khớp mỗi dòng với sản phẩm trong kho (score ≥ 0.5). */
  const autoMatch = useMemo(() => {
    return (name: string): string => {
      let best = ''
      let bestScore = 0.5
      for (const p of products) {
        const s = matchScore(name, p.name)
        if (s > bestScore) { bestScore = s; best = p.id }
      }
      return best
    }
  }, [products])

  async function handleFile(file: File) {
    setLoading(true)
    setError('')
    try {
      let parsed: ParsedInvoice | null = null
      if (file.type.startsWith('image/') && apiBase()) {
        try {
          const part = await fileToBase64(file)
          const text = await scanInvoiceImages([part])
          parsed = parseGeminiInvoiceJson(text)
        } catch (scanErr) {
          const scanMsg = scanErr instanceof Error ? scanErr.message : 'Gemini không đọc được ảnh'
          showToast(`AI không đọc được hoá đơn (${scanMsg}) — đang thử OCR local`, 'bad')
        }
      }
      if (!parsed) {
        parsed = await parseInvoiceFile(file, invoiceLoaders)
      }
      if (!parsed.items.length) {
        setError('Không đọc được dòng hàng nào từ hoá đơn này. Thử file XML/HTML/CSV hoặc kiểm tra lại.')
        return
      }
      setInv(parsed)
      setSupName(parsed.supplier.name || '')
      setDate(parsed.date || today())
      // Khớp NCC theo tên/MST
      const sup = suppliers.find(
        (s) => (parsed.supplier.mst && s.phone === parsed.supplier.mst) ||
          (parsed.supplier.name && normalizeVi(s.name) === normalizeVi(parsed.supplier.name)),
      )
      if (sup) setSupId(sup.id)
      setRows(parsed.items.map((it) => ({
        ...it,
        key: uid('ir'),
        matchId: autoMatch(it.name),
      })))
    } catch (e) {
      logError(e, 'invoiceImport.parse')
      setError(e instanceof Error ? e.message : 'Lỗi khi đọc hoá đơn')
    } finally {
      setLoading(false)
    }
  }

  function updateRow(key: string, patch: Partial<EditRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key))
  }

  const total = rows.reduce((a, r) => a + r.qty * r.cost, 0)
  const newCount = rows.filter((r) => !r.matchId).length

  async function handleSave() {
    if (rows.length === 0) { showToast('Không có dòng nào để nhập', 'bad'); return }
    setSaving(true)
    try {
      // Tạo NCC mới nếu chưa có
      let supplierId = supId
      let supplierName = supName.trim() || 'NCC lẻ'
      if (!supplierId && supName.trim()) {
        const s = await createSupplier({
          name: supName.trim(),
          phone: inv?.supplier.mst || '',
          address: inv?.supplier.addr || '',
        })
        supplierId = s.id
        supplierName = s.name
      }

      // Tạo sản phẩm mới cho dòng chưa khớp
      const prices: Record<string, number> = {}
      const grRows = []
      for (const r of rows) {
        let productId = r.matchId
        if (!productId) {
          const p = await addProduct({
            name: r.name, cat: '', price: r.price || 0, cost: r.cost || 0,
            stock: 0, unit: r.unit || 'cái',
          })
          productId = p.id
        } else if (r.price > 0) {
          prices[productId] = r.price
        }
        grRows.push({
          productId, name: r.name, unit: r.unit || 'cái',
          unitRatio: r.unitRatio && r.unitRatio > 0 ? r.unitRatio : 1,
          qty: r.qty, cost: r.cost, expiry: '',
        })
      }

      const gr = await saveGoodsReceipt({
        supplier: supplierName, supplierId: supplierId || undefined,
        date, expiry: '', note: inv?.note || ('Nhập từ hoá đơn' + (inv?.shdon ? ' ' + inv.shdon : '')),
        rows: grRows, prices,
      })
      showToast(`✓ Đã nhập kho ${fmt(gr.total)}${newCount ? ` (+${newCount} SP mới)` : ''}`, 'ok')
      navigate('/kho')
    } catch (e) {
      logError(e, 'invoiceImport.save')
      showToast('Lỗi khi lưu phiếu nhập', 'bad')
    } finally {
      setSaving(false)
      setConfirmSave(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate('/nhap-hang')}>
          <ChevronLeft size={20} />
        </button>
        <div className="font-brand text-[17px] font-medium flex-1 text-center" style={{ color: 'var(--ink)' }}>
          Nhập từ hoá đơn
        </div>
        <div className="w-9" />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-40 max-w-[520px] mx-auto w-full">
        {!inv && (
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--paper-2)' }}>
              <FileText size={28} style={{ color: 'var(--mute)' }} />
            </div>
            <div className="text-center">
              <div className="text-[15px] font-medium mb-1" style={{ color: 'var(--ink)' }}>Chọn file hoá đơn</div>
              <div className="text-[12.5px]" style={{ color: 'var(--mute)' }}>
                Hỗ trợ XML eInvoice, HTML, CSV, Excel, PDF, ZIP và ảnh (OCR). Tự động đọc tên hàng, SL, đơn giá.
              </div>
            </div>
            <button className="btn-cta flex items-center gap-2" onClick={() => fileRef.current?.click()} disabled={loading}>
              <Upload size={16} /> {loading ? 'Đang đọc…' : 'Chọn file hoá đơn'}
            </button>
            {error && <div className="text-[12.5px] text-center" style={{ color: 'var(--down)' }}>{error}</div>}
          </div>
        )}

        {inv && (
          <>
            {/* Thông tin NCC */}
            <div className="card p-3 flex flex-col gap-2 mb-3">
              <input className="field-input" placeholder="Tên nhà cung cấp" value={supName} onChange={(e) => { setSupName(e.target.value); setSupId('') }} />
              {suppliers.length > 0 && (
                <select className="field-input" value={supId} onChange={(e) => {
                  const s = suppliers.find((x) => x.id === e.target.value)
                  setSupId(e.target.value)
                  if (s) setSupName(s.name)
                }}>
                  <option value="">— NCC mới / lẻ —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input className="field-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                {inv.shdon && <input className="field-input" value={'Số HĐ: ' + inv.shdon} disabled />}
              </div>
            </div>

            <div className="section-label">Dòng hàng ({rows.length}){newCount ? ` · ${newCount} mới` : ''}</div>
            <div className="flex flex-col gap-2">
              {rows.map((r) => {
                const matched = products.find((p) => p.id === r.matchId)
                return (
                  <div key={r.key} className="card p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <input
                        className="field-input !py-1.5 text-sm flex-1"
                        value={r.name}
                        onChange={(e) => updateRow(r.key, { name: e.target.value })}
                      />
                      <button onClick={() => removeRow(r.key)} aria-label="Xóa dòng" className="p-1">
                        <Trash2 size={15} style={{ color: 'var(--down)' }} />
                      </button>
                    </div>
                    {/* Khớp sản phẩm */}
                    <button
                      className="flex items-center gap-1.5 text-[11.5px] mb-2 px-2 py-1 rounded-lg w-full text-left"
                      style={{ background: 'var(--paper-2)', color: matched ? 'var(--up)' : 'var(--mute)' }}
                      onClick={() => {
                        const id = autoMatch(r.name)
                        updateRow(r.key, { matchId: id })
                        if (!id) showToast('Không tìm thấy SP khớp — sẽ tạo mới khi lưu', 'bad')
                      }}
                    >
                      {matched ? <Link2 size={12} /> : <Plus size={12} />}
                      {matched ? `Khớp: ${matched.name}` : 'Tạo sản phẩm mới'}
                    </button>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px]" style={{ color: 'var(--mute)' }}>SL</span>
                        <input className="field-input !py-1.5 text-sm" type="number" inputMode="numeric" value={r.qty || ''} onChange={(e) => updateRow(r.key, { qty: Number(e.target.value) || 0 })} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px]" style={{ color: 'var(--mute)' }}>Giá vốn</span>
                        <input className="field-input !py-1.5 text-sm" type="number" inputMode="numeric" value={r.cost || ''} onChange={(e) => updateRow(r.key, { cost: Number(e.target.value) || 0 })} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px]" style={{ color: 'var(--mute)' }}>Giá bán</span>
                        <input className="field-input !py-1.5 text-sm" type="number" inputMode="numeric" value={r.price || ''} onChange={(e) => updateRow(r.key, { price: Number(e.target.value) || 0 })} />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>

            <button className="btn-ghost w-full mt-3 text-[12px]" onClick={() => { setInv(null); setRows([]); setError('') }}>
              Đọc file khác
            </button>
          </>
        )}
      </div>

      {inv && (
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
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".xml,.html,.htm,.csv,.txt,.xlsx,.xls,.pdf,.zip,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
          e.target.value = ''
        }}
      />

      <ConfirmDialog
        open={confirmSave}
        title="Lưu phiếu nhập?"
        message={`Nhập ${rows.length} dòng, tổng ${fmt(total)}${newCount ? `. Tạo mới ${newCount} sản phẩm chưa có trong kho.` : '.'}`}
        confirmLabel="Lưu"
        onConfirm={handleSave}
        onCancel={() => setConfirmSave(false)}
      />
    </div>
  )
}
