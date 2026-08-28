/**
 * 3SU Next — Nhập hàng từ hoá đơn (UI)
 * Port từ 24-invoice-import.js: chọn file hoá đơn (XML/HTML/CSV/Excel/PDF/ảnh),
 * parse tự động → preview sửa → khớp sản phẩm (PMATCH v2.7.4) → lưu phiếu nhập.
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, today, normalizeVi, uid, matchesSearch } from '@/core/format'
import { parseInvoiceFile, type ParsedInvoice, type ParsedItem } from '@/core/domain/invoiceImport'
import { fileToScanPart, scanInvoiceImages } from '@/core/ai/client'
import { parseGeminiInvoiceJson } from '@/core/ai/invoiceScan'
import { apiBase } from '@/core/sync/cloud'
import { invoiceLoaders } from '@/core/browser/invoiceLoaders'
import { commitInvoiceImport } from '@/core/domain/inventory'
import { logError } from '@/core/errorLogger'
import {
  candidates,
  matchLine,
  manualMatch,
  newProductMatch,
  resolveMatchForCommit,
  type ProductAlias,
  type ProductMatch,
} from '@/core/domain/productMatcher'
import { learnProductAlias, loadProductAliases } from '@/core/domain/productAliases'
import { ConfirmDialog, Sheet } from '@/shared/components'
import { useUnsavedDraftGuard } from '@/shared/useUnsavedDraftGuard'
import {
  DRAFT_INVOICE, clearDraft, loadFreshDraft, persistInvoiceDraft, type InvoiceDraft,
} from '@/core/domain/drafts'
import { ChevronLeft, Upload, FileText, Trash2 } from 'lucide-react'
import type { Product, Supplier } from '@/core/types'

interface EditRow extends ParsedItem {
  key: string
  match: ProductMatch
  confirmed: boolean
}

function matchTone(row: EditRow): 'ok' | 'sug' | 'none' | 'new' {
  const m = row.match
  if (m.mode === 'new') return 'new'
  if (m.mode === 'product' && m.pid) {
    if (m.why === 'fuzzy' && !row.confirmed) return 'sug'
    return 'ok'
  }
  return 'none'
}

function matchStyle(tone: ReturnType<typeof matchTone>): { background: string; color: string; border: string } {
  if (tone === 'ok') {
    return { background: 'color-mix(in srgb, var(--up) 12%, var(--paper))', color: 'var(--up)', border: '1px solid color-mix(in srgb, var(--up) 35%, transparent)' }
  }
  if (tone === 'sug') {
    return { background: 'var(--warn-bg)', color: 'var(--warn)', border: '1px solid color-mix(in srgb, var(--warn) 40%, transparent)' }
  }
  if (tone === 'new') {
    return { background: 'var(--paper-2)', color: 'var(--mute)', border: '1px solid var(--hair)' }
  }
  return { background: 'color-mix(in srgb, var(--down) 8%, var(--paper))', color: 'var(--down)', border: '1.5px dashed color-mix(in srgb, var(--down) 55%, transparent)' }
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
  const [expiry, setExpiry] = useState('')
  const [paid, setPaid] = useState(0)
  const [payMethod, setPayMethod] = useState<'cash' | 'transfer' | 'debt'>('debt')
  const [confirmSave, setConfirmSave] = useState(false)
  const [saving, setSaving] = useState(false)
  const [aliases, setAliases] = useState<ProductAlias[]>([])
  const [pickKey, setPickKey] = useState<string | null>(null)
  const [pickQ, setPickQ] = useState('')
  const lastCatalogKey = useRef('')
  const draftReady = useRef(false)
  const leave = useUnsavedDraftGuard(inv != null)
  const gdtBlocked = typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')

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
  const catalogKey = `${products.length}|${aliases.length}|${supId}`

  useEffect(() => {
    void loadProductAliases().then(setAliases)
  }, [])

  useEffect(() => {
    void loadFreshDraft<InvoiceDraft>(DRAFT_INVOICE).then((d) => {
      if (!d) { draftReady.current = true; return }
      setInv(d.inv as ParsedInvoice | null)
      setRows((d.rows || []) as EditRow[])
      setSupName(d.supName)
      setSupId(d.supId)
      setDate(d.date)
      setExpiry(d.expiry)
      setPaid(d.paid)
      setPayMethod(d.payMethod)
      draftReady.current = true
    }).catch(() => { draftReady.current = true })
  }, [])

  useEffect(() => {
    if (!draftReady.current) return
    const tmr = window.setTimeout(() => {
      void persistInvoiceDraft({
        inv, rows, supName, supId, date, expiry, paid, payMethod,
      })
    }, 400)
    return () => window.clearTimeout(tmr)
  }, [inv, rows, supName, supId, date, expiry, paid, payMethod])

  function applyMatch(name: string, sku: string, nextSupId = supId): ProductMatch {
    return matchLine(name, sku, nextSupId, products, aliases)
  }

  useEffect(() => {
    if (!inv) {
      lastCatalogKey.current = ''
      return
    }
    if (catalogKey === lastCatalogKey.current) return
    lastCatalogKey.current = catalogKey
    setRows((rs) => {
      if (!rs.length) return rs
      return rs.map((r) => ({
        ...r,
        match: matchLine(r.name, r.sku, supId, products, aliases),
        confirmed: false,
      }))
    })
  }, [catalogKey, aliases, products, supId, inv])

  async function handleFile(file: File) {
    setLoading(true)
    setError('')
    try {
      let parsed: ParsedInvoice | null = null
      if (file.type.startsWith('image/') && apiBase()) {
        try {
          const part = await fileToScanPart(file)
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
      const als = aliases.length ? aliases : await loadProductAliases()
      if (als !== aliases) setAliases(als)
      const sup = suppliers.find(
        (s) => (parsed.supplier.mst && s.phone === parsed.supplier.mst) ||
          (parsed.supplier.name && normalizeVi(s.name) === normalizeVi(parsed.supplier.name)),
      )
      const nextSupId = sup?.id || ''
      if (sup) setSupId(sup.id)
      else setSupId('')
      setRows(parsed.items.map((it) => ({
        ...it,
        key: uid('ir'),
        match: matchLine(it.name, it.sku, nextSupId, products, als),
        confirmed: false,
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
    if (pickKey === key) { setPickKey(null); setPickQ('') }
  }

  const total = rows.reduce((a, r) => a + r.qty * r.cost, 0)
  const newCount = rows.filter((r) => !resolveMatchForCommit(r.match, r.confirmed).productId).length
  const pickRow = rows.find((r) => r.key === pickKey) || null
  const pickList = (() => {
    if (!pickRow) return [] as { p: Product; score: number | null }[]
    const q = pickQ.trim()
    if (q) {
      return products
        .filter((p) => matchesSearch(`${p.name} ${p.cat} ${p.barcode}`, q))
        .slice(0, 30)
        .map((p) => ({ p, score: null }))
    }
    return candidates(pickRow.name, products, 8).map((c) => ({
      p: c.p as Product,
      score: c.score,
    }))
  })()

  async function handleSave() {
    if (rows.length === 0) { showToast('Không có dòng nào để nhập', 'bad'); return }
    if (rows.some((r) => matchTone(r) === 'sug')) {
      showToast('Xác nhận gợi ý khớp hoặc chọn Tạo mới trên từng dòng', 'bad')
      setConfirmSave(false)
      return
    }
    setSaving(true)
    try {
      const prices: Record<string, number> = {}
      const newProducts: Array<{ name: string; cat: string; price: number; cost: number; stock: number; unit: string }> = []
      const grRows: Array<{
        productId: string; name: string; unit: string; unitRatio: number; qty: number; cost: number; expiry: string; newProductIndex?: number
      }> = []
      const toLearn: { name: string; sku: string; pid?: string; newProductIndex?: number }[] = []
      for (const r of rows) {
        const resolved = resolveMatchForCommit(r.match, r.confirmed)
        if (!resolved.productId) {
          const idx = newProducts.length
          newProducts.push({
            name: r.name, cat: '', price: r.price || 0, cost: r.cost || 0,
            stock: 0, unit: r.unit || 'cái',
          })
          grRows.push({
            productId: '', name: r.name, unit: r.unit || 'cái',
            unitRatio: r.unitRatio && r.unitRatio > 0 ? r.unitRatio : 1,
            qty: r.qty, cost: r.cost, expiry: '', newProductIndex: idx,
          })
        } else {
          if (r.price > 0) prices[resolved.productId] = r.price
          if (resolved.learn) toLearn.push({ name: r.name, sku: r.sku || '', pid: resolved.productId })
          grRows.push({
            productId: resolved.productId, name: r.name, unit: r.unit || 'cái',
            unitRatio: r.unitRatio && r.unitRatio > 0 ? r.unitRatio : 1,
            qty: r.qty, cost: r.cost, expiry: '',
          })
        }
      }

      const { gr, productIds } = await commitInvoiceImport({
        supplierName: supName.trim() || 'NCC lẻ',
        supplierId: supId || undefined,
        createSupplier: !supId && supName.trim() ? {
          name: supName.trim(),
          phone: inv?.supplier.mst || '',
          address: inv?.supplier.addr || '',
        } : undefined,
        date,
        expiry,
        note: inv?.note || ('Nhập từ hoá đơn' + (inv?.shdon ? ' ' + inv.shdon : '')),
        payMethod,
        paid: payMethod === 'debt' ? 0 : paid,
        newProducts,
        rows: grRows,
        prices,
      })
      const sid = gr.supplierId || ''
      await Promise.all(toLearn.map((x) => learnProductAlias(x.name, x.sku, sid, x.pid!)))
      for (const r of grRows) {
        if (r.newProductIndex != null) {
          const pid = productIds[r.newProductIndex]
          if (pid) await learnProductAlias(r.name, '', sid, pid)
        }
      }
      showToast(`✓ Đã nhập kho ${fmt(gr.total)}${newCount ? ` (+${newCount} SP mới)` : ''}`, 'ok')
      leave.allowLeave()
      await clearDraft(DRAFT_INVOICE)
      navigate('/kho')
    } catch (e) {
      logError(e, 'invoiceImport.save')
      showToast(e instanceof Error ? e.message : 'Lỗi khi lưu phiếu nhập', 'bad')
    } finally {
      setSaving(false)
      setConfirmSave(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {gdtBlocked && (
        <div className="px-4 py-2 text-xs" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>
          Kéo hóa đơn trực tiếp từ GDT chỉ trên 3su.shop. Máy này chọn file XML/HTML/Excel.
        </div>
      )}
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
              <div className="text-[12px]" style={{ color: 'var(--mute)' }}>
                Hỗ trợ XML eInvoice, HTML, CSV, Excel, PDF, ZIP và ảnh (OCR). Tự động đọc tên hàng, SL, đơn giá.
              </div>
            </div>
            <button className="btn-cta flex items-center gap-2" onClick={() => fileRef.current?.click()} disabled={loading}>
              <Upload size={16} /> {loading ? 'Đang đọc…' : 'Chọn file hoá đơn'}
            </button>
            {error && <div className="text-[12px] text-center" style={{ color: 'var(--down)' }}>{error}</div>}
          </div>
        )}

        {inv && (
          <>
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
                const matched = r.match.mode === 'product' ? products.find((p) => p.id === r.match.pid) : undefined
                const tone = matchTone(r)
                const fuzzyPending = tone === 'sug' && matched
                return (
                  <div key={r.key} className="card p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <input
                        className="field-input !py-1.5 text-sm flex-1"
                        value={r.name}
                        onChange={(e) => {
                          const name = e.target.value
                          updateRow(r.key, { name, match: applyMatch(name, r.sku), confirmed: false })
                        }}
                      />
                      <button onClick={() => removeRow(r.key)} aria-label="Xóa dòng" className="p-1">
                        <Trash2 size={15} style={{ color: 'var(--down)' }} />
                      </button>
                    </div>
                    <div
                      className="flex items-start gap-1.5 text-[12px] mb-2 px-2.5 py-2 rounded-[10px] w-full leading-snug font-medium"
                      style={matchStyle(tone)}
                    >
                      <button
                        type="button"
                        className="flex-1 min-w-0 text-left"
                        onClick={() => { setPickKey(r.key); setPickQ('') }}
                      >
                        {fuzzyPending && (
                          <>≈ {matched.name} · gợi ý {Math.round((r.match.score || 0) * 100)}% — không xác nhận sẽ tạo mới</>
                        )}
                        {tone === 'ok' && matched && (
                          <>✓ {matched.name}{r.match.why === 'alias' ? ' · đã học' : r.match.why === 'manual' ? '' : ' · trùng tên'} (tồn {matched.stock || 0})</>
                        )}
                        {tone === 'new' && '+ Tạo sản phẩm mới trong kho'}
                        {tone === 'none' && '+ Sẽ tạo SP mới khi lưu — chạm để ghép SP có sẵn'}
                      </button>
                      {fuzzyPending && (
                        <button
                          type="button"
                          className="shrink-0 px-2 py-0.5 rounded-md text-[11px] font-bold text-white"
                          style={{ background: '#10b981' }}
                          onClick={() => updateRow(r.key, {
                            confirmed: true,
                            match: { ...r.match, why: 'manual' },
                          })}
                        >
                          Xác nhận
                        </button>
                      )}
                    </div>
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

            <button className="btn-ghost w-full mt-3 text-[12px]" onClick={() => { setInv(null); setRows([]); setError(''); setPickKey(null) }}>
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
            <div className="grid grid-cols-2 gap-2 mb-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px]" style={{ color: 'var(--mute)' }}>HSD phiếu</span>
                <input className="field-input !py-2 text-sm" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              </label>
              <div className="flex flex-col gap-1">
                <span className="text-[11px]" style={{ color: 'var(--mute)' }}>Thanh toán</span>
                <div className="flex gap-1">
                  {([['cash', 'TM'], ['transfer', 'CK'], ['debt', 'Nợ']] as const).map(([v, label]) => (
                    <button key={v} type="button" className={'chip ' + (payMethod === v ? 'chip-on' : '')} onClick={() => setPayMethod(v)}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
            {payMethod !== 'debt' && (
              <input className="field-input mb-3" type="number" inputMode="numeric" placeholder="Số tiền đã trả" value={paid || ''} onChange={(e) => setPaid(Number(e.target.value) || 0)} />
            )}
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

      <Sheet
        open={!!pickRow}
        onClose={() => { setPickKey(null); setPickQ('') }}
        title="Ghép với sản phẩm trong kho"
      >
        {pickRow && (
          <div className="flex flex-col gap-3">
            <div className="text-[12px]" style={{ color: 'var(--mute)' }}>
              Dòng hoá đơn: <b style={{ color: 'var(--ink)' }}>{pickRow.name}</b>
              {pickRow.sku ? ` · mã ${pickRow.sku}` : ''}
            </div>
            <input
              className="field-input"
              placeholder="Tìm trong kho (sai dấu, viết tắt cũng được)…"
              value={pickQ}
              onChange={(e) => setPickQ(e.target.value)}
              autoFocus
            />
            <div className="flex flex-col gap-1 max-h-[42vh] overflow-y-auto">
              <button
                type="button"
                className="w-full text-left px-3 py-2.5 rounded-xl text-[13px] font-medium"
                style={{ background: 'var(--paper-2)', color: 'var(--ink)' }}
                onClick={() => {
                  updateRow(pickRow.key, { match: newProductMatch(pickRow.match.cands), confirmed: false })
                  setPickKey(null)
                  setPickQ('')
                }}
              >
                + Tạo sản phẩm mới: “{pickRow.name}”
              </button>
              {pickList.map(({ p, score }) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-2"
                  style={{ background: 'var(--paper-2)' }}
                  onClick={() => {
                    updateRow(pickRow.key, { match: manualMatch(p.id, pickRow.match.cands), confirmed: true })
                    setPickKey(null)
                    setPickQ('')
                  }}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium truncate" style={{ color: 'var(--ink)' }}>{p.name}</span>
                    <span className="block text-[12px]" style={{ color: 'var(--mute)' }}>
                      tồn {p.stock || 0} {p.unit || ''} · vốn {fmt(p.cost || 0)}
                    </span>
                  </span>
                  {score != null && (
                    <b className="text-[12px] shrink-0" style={{ color: 'var(--ink)' }}>{Math.round(score * 100)}%</b>
                  )}
                </button>
              ))}
              {pickList.length === 0 && (
                <div className="text-center text-[12px] py-3" style={{ color: 'var(--mute)' }}>
                  Không có gợi ý đủ giống — gõ ô trên để tìm trong kho
                </div>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmSave}
        title="Lưu phiếu nhập?"
        message={`Nhập ${rows.length} dòng, tổng ${fmt(total)}${newCount ? `. Tạo mới ${newCount} sản phẩm chưa có trong kho.` : '.'}`}
        confirmLabel="Lưu"
        onConfirm={handleSave}
        onCancel={() => setConfirmSave(false)}
      />
      {leave.dialog}
    </div>
  )
}
