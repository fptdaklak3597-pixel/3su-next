/**
 * Thêm / sửa sản phẩm web.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ScanLine } from 'lucide-react'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { addProduct, deleteProduct, productCategories, updateProduct } from '@/core/domain/inventory'
import { createBarcodeScan, type ScanHandle } from '@/core/browser/barcode'
import { createScanSession } from '@/core/browser/barcodeSession'
import { expiryText, fmt } from '@/core/format'
import { logError } from '@/core/errorLogger'
import { createConfirmGate } from '@/core/confirmGate'
import { ConfirmDialog, Modal } from '@/shared/components'
import { useUnsavedDraftGuard } from '@/shared/useUnsavedDraftGuard'
import { DRAFT_PRODUCT, clearDraft, loadFreshDraft, persistProductDraft, type ProductDraft } from '@/core/domain/drafts'
import type { PriceLogEntry, Product } from '@/core/types'

function PriceLogCard({ productId }: { productId: string }) {
  const logs = useLiveQuery(
    () => dbx.priceLog.where('productId').equals(productId).toArray(),
    [productId],
    [] as PriceLogEntry[],
  )
  const sorted = [...logs].sort((a, b) => b.ts - a.ts)
  if (!sorted.length) return null
  return (
    <section className="web-form-section">
      <header>
        <h3>Nhật ký giá nhập</h3>
        <p>12 lần gần nhất</p>
      </header>
      {sorted.slice(0, 12).map((l) => (
        <div key={l.id} className="web-ln">
          <span>{l.supName || 'NCC'} · {new Date(l.ts).toLocaleDateString('vi-VN')}</span>
          <span>{fmt(l.cost)}</span>
        </div>
      ))}
    </section>
  )
}

function marginMeta(price: number, cost: number) {
  if (!(price > 0)) return { label: '—', tone: '' as const, amount: 0 }
  const amount = price - cost
  const pct = cost > 0 ? Math.round((amount / price) * 100) : null
  const label = pct == null ? fmt(amount) : `${fmt(amount)} · ${pct}%`
  const tone = amount < 0 ? 'bad' as const : amount > 0 ? 'ok' as const : '' as const
  return { label, tone, amount }
}

export function WebProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const isNew = id === 'new'
  const product = useLiveQuery(() => (!isNew && id ? dbx.products.get(id) : undefined), [id, isNew])
  const products = useLiveQuery(
    () => dbx.products.filter((p) => !p.deleted).toArray(),
    [],
    [] as Product[],
  )
  const cats = useMemo(() => productCategories(products), [products])

  const [form, setForm] = useState({
    name: '', cat: '', price: 0, cost: 0, stock: 0, unit: 'cái', barcode: '', expiry: '', wholesalePrice: 0,
    pack1n: '', pack1r: 0, pack2n: '', pack2r: 0,
  })
  const [confirmDel, setConfirmDel] = useState(false)
  const [confirmStock, setConfirmStock] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const confirmGate = useRef(createConfirmGate())
  const dirtyRef = useRef(false)
  const [dirty, setDirty] = useState(false)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const leave = useUnsavedDraftGuard(dirty)
  const nameRef = useRef<HTMLInputElement>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)
  const scanRef = useRef<ScanHandle | null>(null)
  const sessionRef = useRef(createScanSession())
  const videoRef = useRef<HTMLVideoElement>(null)

  const set = (k: string, v: string | number) => {
    dirtyRef.current = true
    setDirty(true)
    setForm((f) => ({ ...f, [k]: v }))
  }

  useEffect(() => {
    dirtyRef.current = false
    setDirty(false)
    setDraftHydrated(false)
    let cancelled = false
    void loadFreshDraft<ProductDraft>(DRAFT_PRODUCT).then((d) => {
      if (cancelled) return
      const pid = isNew ? 'new' : (id || '')
      if (d && d.productId === pid && d.form && typeof d.form === 'object') {
        setForm((prev) => ({ ...prev, ...(d.form as typeof prev) }))
        dirtyRef.current = true
        setDirty(true)
      }
      setDraftHydrated(true)
    }).catch(() => { if (!cancelled) setDraftHydrated(true) })
    return () => { cancelled = true }
  }, [id, isNew])

  useEffect(() => {
    if (!dirty || !draftHydrated) return
    const tmr = window.setTimeout(() => {
      void persistProductDraft({ isNew, productId: isNew ? 'new' : (id || ''), form })
    }, 400)
    return () => window.clearTimeout(tmr)
  }, [form, dirty, draftHydrated, isNew, id])

  useEffect(() => {
    if (isNew) {
      const t = window.setTimeout(() => nameRef.current?.focus(), 40)
      return () => window.clearTimeout(t)
    }
  }, [isNew, id])

  useEffect(() => {
    if (product && !dirtyRef.current && draftHydrated) {
      setForm({
        name: product.name,
        cat: product.cat,
        price: product.price,
        cost: product.cost,
        stock: product.stock,
        unit: product.unit,
        barcode: product.barcode,
        expiry: product.expiry,
        wholesalePrice: product.wholesalePrice,
        pack1n: product.units[0]?.n || '',
        pack1r: product.units[0]?.r || 0,
        pack2n: product.units[1]?.n || '',
        pack2r: product.units[1]?.r || 0,
      })
    }
  }, [product, draftHydrated])

  useEffect(() => () => { sessionRef.current?.cancel(); scanRef.current?.cancel() }, [])

  const margin = marginMeta(form.price, form.cost)
  const stockDelta = !isNew && product && form.stock !== product.stock
    ? form.stock - product.stock
    : null

  async function persistProduct() {
    if (!form.name.trim()) {
      showToast('Nhập tên sản phẩm', 'bad')
      nameRef.current?.focus()
      return
    }
    const units = [
      form.pack1n.trim() && form.pack1r > 1 ? { n: form.pack1n.trim(), r: form.pack1r } : null,
      form.pack2n.trim() && form.pack2r > 1 ? { n: form.pack2n.trim(), r: form.pack2r } : null,
    ].filter(Boolean) as { n: string; r: number }[]
    if (!confirmGate.current.tryEnter()) return
    setSaving(true)
    try {
      if (isNew) {
        await addProduct({
          name: form.name, cat: form.cat, price: form.price, cost: form.cost,
          stock: form.stock, unit: form.unit.trim(), barcode: form.barcode.trim(),
          expiry: form.expiry, wholesalePrice: form.wholesalePrice, units,
        })
        showToast('✓ Đã thêm sản phẩm', 'ok')
      } else {
        await updateProduct(id!, {
          name: form.name.trim(), cat: form.cat.trim(), price: form.price, cost: form.cost,
          stock: form.stock, unit: form.unit.trim(), barcode: form.barcode.trim(), expiry: form.expiry,
          wholesalePrice: form.wholesalePrice, units,
        })
        showToast('✓ Đã lưu', 'ok')
      }
      leave.allowLeave()
      await clearDraft(DRAFT_PRODUCT)
      navigate('/kho')
    } catch (e) {
      logError(e, 'product.save')
      showToast(e instanceof Error ? e.message : 'Lỗi khi lưu', 'bad')
    } finally {
      setSaving(false)
      confirmGate.current.leave()
    }
  }

  async function handleSave() {
    if (stockDelta != null) {
      setConfirmStock(true)
      return
    }
    await persistProduct()
  }

  async function handleDelete() {
    try {
      await deleteProduct(id!)
      showToast('Đã xóa sản phẩm', 'ok')
      navigate('/kho')
    } catch (e) {
      logError(e, 'product.delete')
      showToast(e instanceof Error ? e.message : 'Lỗi khi xóa', 'bad')
    }
  }

  async function handleScanBarcode() {
    sessionRef.current = createScanSession()
    setScanOpen(true)
    try {
      const handle = await createBarcodeScan({
        onError: (m) => showToast(m, 'bad'),
        onInfo: (m) => showToast(m, 'ok'),
      })
      sessionRef.current.adopt(handle)
      if (sessionRef.current.cancelled) return
      scanRef.current = handle
      requestAnimationFrame(() => {
        if (videoRef.current) handle.attach(videoRef.current)
      })
      const code = await handle.promise
      if (code) {
        set('barcode', code)
        showToast('Đã nhận mã ' + code, 'ok')
        barcodeRef.current?.focus()
      }
    } catch {
      /* toast đã hiện */
    } finally {
      scanRef.current = null
      setScanOpen(false)
    }
  }

  const actions = (
    <div className="web-ph-actions">
      <button type="button" className="web-btn" onClick={() => navigate('/kho')}>Hàng hóa</button>
      {!isNew && (
        <button
          type="button"
          className="web-btn danger"
          disabled={(product?.stock ?? 0) > 0}
          title={(product?.stock ?? 0) > 0 ? 'Điều chỉnh tồn về 0 rồi mới xóa' : 'Xóa sản phẩm'}
          onClick={() => (product?.stock ?? 0) <= 0 && setConfirmDel(true)}
        >Xóa</button>
      )}
      <button type="button" className="web-btn pri" disabled={saving} onClick={() => void handleSave()}>
        {saving ? 'Đang lưu…' : isNew ? 'Thêm sản phẩm' : 'Lưu'}
      </button>
    </div>
  )

  return (
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>{isNew ? 'Thêm sản phẩm' : 'Sửa sản phẩm'}</h2>
          {!isNew && product ? (
            <p>
              Tồn {product.stock} {product.unit}
              {' · '}lãi {fmt(product.price - product.cost)}
              {product.expiry ? ` · ${expiryText(product.expiry)}` : ''}
            </p>
          ) : (
            <p>Điền tên + giá bán là bán được. Mã vạch và đơn vị phụ thêm khi cần.</p>
          )}
        </div>
        {actions}
      </div>

      <div className="web-product-layout">
        <div className="web-product-main">
          <section className="web-form-section">
            <header>
              <h3>Thông tin cơ bản</h3>
              <p>Tên hiện trên hóa đơn và màn bán</p>
            </header>
            <div className="web-form-grid">
              <label className="web-field web-span-2">
                <span>Tên sản phẩm *</span>
                <input
                  ref={nameRef}
                  className="web-input"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="VD: Gạo ST25 5kg"
                  autoComplete="off"
                />
              </label>
              <label className="web-field">
                <span>Nhóm hàng</span>
                <input
                  className="web-input"
                  list="web-product-cats"
                  value={form.cat}
                  onChange={(e) => set('cat', e.target.value)}
                  placeholder="VD: Gạo, Nước ngọt"
                  autoComplete="off"
                />
                <datalist id="web-product-cats">
                  {cats.map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label className="web-field">
                <span>Đơn vị cơ bản</span>
                <input
                  className="web-input"
                  value={form.unit}
                  onChange={(e) => set('unit', e.target.value)}
                  placeholder="cái, gói, kg…"
                  autoComplete="off"
                />
              </label>
              <label className="web-field web-span-2">
                <span>Mã vạch</span>
                <div className="web-barcode-row">
                  <input
                    ref={barcodeRef}
                    className="web-input"
                    value={form.barcode}
                    onChange={(e) => set('barcode', e.target.value)}
                    placeholder="Quét súng vào ô này, hoặc bấm camera"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button type="button" className="web-btn" onClick={() => void handleScanBarcode()} title="Quét bằng camera">
                    <ScanLine size={15} /> Camera
                  </button>
                </div>
                <span className="web-hint">Súng USB: click vào ô rồi quét. Không cần mở camera.</span>
              </label>
            </div>
          </section>

          <section className="web-form-section">
            <header>
              <h3>Giá & tồn</h3>
              {form.price > 0 && (
                <span className={`web-margin-pill ${margin.tone}`}>Lãi {margin.label}</span>
              )}
            </header>
            <div className="web-form-grid">
              <label className="web-field">
                <span>Giá bán</span>
                <input
                  className="web-input"
                  type="number"
                  min={0}
                  value={form.price || ''}
                  onChange={(e) => set('price', Number(e.target.value))}
                  placeholder="0"
                />
              </label>
              <label className="web-field">
                <span>Giá vốn</span>
                <input
                  className="web-input"
                  type="number"
                  min={0}
                  value={form.cost || ''}
                  onChange={(e) => set('cost', Number(e.target.value))}
                  placeholder="0"
                />
              </label>
              <label className="web-field">
                <span>Giá sỉ</span>
                <input
                  className="web-input"
                  type="number"
                  min={0}
                  value={form.wholesalePrice || ''}
                  onChange={(e) => set('wholesalePrice', Number(e.target.value))}
                  placeholder="0 = không dùng"
                />
                <span className="web-hint">Để 0 nếu không bán sỉ</span>
              </label>
              <label className="web-field">
                <span>Tồn kho</span>
                <input
                  className="web-input"
                  type="number"
                  value={form.stock || ''}
                  onChange={(e) => set('stock', Number(e.target.value))}
                  placeholder="0"
                />
                {!isNew && (
                  <span className="web-hint">Đổi tay ghi điều chỉnh tồn, không tạo phiếu nhập.</span>
                )}
              </label>
            </div>
          </section>

          <section className="web-form-section">
            <header>
              <h3>Hạn dùng & quy đổi</h3>
              <p>Tuỳ chọn — bỏ trống nếu không cần</p>
            </header>
            <div className="web-form-grid">
              <label className="web-field web-span-2">
                <span>Hạn sử dụng</span>
                <input
                  className="web-input"
                  type="date"
                  value={form.expiry}
                  onChange={(e) => set('expiry', e.target.value)}
                />
              </label>
              <label className="web-field">
                <span>Đơn vị phụ 1</span>
                <input
                  className="web-input"
                  value={form.pack1n}
                  onChange={(e) => set('pack1n', e.target.value)}
                  placeholder="thùng"
                  autoComplete="off"
                />
              </label>
              <label className="web-field">
                <span>Hệ số 1</span>
                <input
                  className="web-input"
                  type="number"
                  min={2}
                  value={form.pack1r || ''}
                  onChange={(e) => set('pack1r', Number(e.target.value))}
                  placeholder="vd 24"
                />
                <span className="web-hint">1 thùng = bao nhiêu {form.unit || 'đơn vị'}?</span>
              </label>
              <label className="web-field">
                <span>Đơn vị phụ 2</span>
                <input
                  className="web-input"
                  value={form.pack2n}
                  onChange={(e) => set('pack2n', e.target.value)}
                  placeholder="lốc"
                  autoComplete="off"
                />
              </label>
              <label className="web-field">
                <span>Hệ số 2</span>
                <input
                  className="web-input"
                  type="number"
                  min={2}
                  value={form.pack2r || ''}
                  onChange={(e) => set('pack2r', Number(e.target.value))}
                  placeholder="vd 6"
                />
              </label>
            </div>
          </section>

          {!isNew && id && <PriceLogCard productId={id} />}

          <div className="web-product-foot">{actions}</div>
        </div>

        <aside className="web-product-aside">
          <div className="web-product-preview">
            <div className="kicker">Xem nhanh</div>
            <p className={`title${form.name.trim() ? '' : ' is-empty'}`}>
              {form.name.trim() || 'Chưa đặt tên'}
            </p>
            <div className="row"><span>Nhóm</span><strong>{form.cat.trim() || '—'}</strong></div>
            <div className="row"><span>Đơn vị</span><strong>{form.unit.trim() || '—'}</strong></div>
            <div className="row"><span>Giá bán</span><strong>{form.price > 0 ? fmt(form.price) : '—'}</strong></div>
            <div className="row"><span>Giá vốn</span><strong>{form.cost > 0 ? fmt(form.cost) : '—'}</strong></div>
            <div className="row">
              <span>Lãi / SP</span>
              <strong className={margin.tone}>{form.price > 0 ? margin.label : '—'}</strong>
            </div>
            <div className="row"><span>Tồn</span><strong>{form.stock || 0} {form.unit || ''}</strong></div>
            <div className="row"><span>Mã vạch</span><strong>{form.barcode.trim() || '—'}</strong></div>
          </div>
          <div className="web-product-tip">
            <strong>Súng quét:</strong> click ô Mã vạch rồi quét. Khi bán hàng, quét trên màn Bán hàng để thêm vào giỏ — không cần mở trang này.
          </div>
        </aside>
      </div>

      <Modal
        open={scanOpen}
        onClose={() => {
          sessionRef.current.cancel()
          scanRef.current?.cancel()
          setScanOpen(false)
        }}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="text-sm font-medium">Hướng camera vào mã vạch</div>
          <video
            ref={videoRef}
            className="w-full rounded-xl"
            style={{ maxHeight: 280, background: '#000' }}
            playsInline
            muted
          />
          <button
            type="button"
            className="web-btn"
            onClick={() => {
              sessionRef.current.cancel()
              scanRef.current?.cancel()
              setScanOpen(false)
            }}
          >
            Đóng
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmStock}
        title="Đổi tồn kho?"
        message={stockDelta == null
          ? ''
          : `Tồn trên máy này sẽ thành ${form.stock} ${form.unit || ''} (đổi ${stockDelta > 0 ? '+' : ''}${stockDelta}). Máy khác cộng/trừ ${stockDelta}, không ghi đè tồn họ.`}
        confirmLabel="Lưu tồn"
        onConfirm={() => { setConfirmStock(false); void persistProduct() }}
        onCancel={() => setConfirmStock(false)}
      />
      <ConfirmDialog
        open={confirmDel}
        title="Xóa sản phẩm?"
        message={`"${product?.name}" sẽ bị xóa khỏi kho. Lịch sử bán hàng vẫn giữ nguyên. Còn tồn thì phải điều chỉnh về 0 trước.`}
        confirmLabel="Xóa"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDel(false)}
      />
      {leave.dialog}
    </div>
  )
}
