/**
 * 3SU Next — Chi tiết / Thêm / Sửa sản phẩm
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { addProduct, updateProduct, deleteProduct } from '@/core/domain/inventory'
import { fmt, expiryText } from '@/core/format'
import { logError } from '@/core/errorLogger'
import { createConfirmGate } from '@/core/confirmGate'
import { ConfirmDialog } from '@/shared/components'
import { useUnsavedDraftGuard } from '@/shared/useUnsavedDraftGuard'
import { DRAFT_PRODUCT, clearDraft, loadFreshDraft, persistProductDraft, type ProductDraft } from '@/core/domain/drafts'
import { ChevronLeft, Trash2 } from 'lucide-react'

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const isNew = id === 'new'
  const [saving, setSaving] = useState(false)
  const confirmGate = useRef(createConfirmGate())

  const product = useLiveQuery(
    () => (!isNew && id ? dbx.products.get(id) : undefined),
    [id, isNew],
  )

  const [form, setForm] = useState({
    name: '', cat: '', price: 0, cost: 0, stock: 0, unit: 'cái', barcode: '', expiry: '', wholesalePrice: 0,
  })
  const [confirmDel, setConfirmDel] = useState(false)
  const [confirmStock, setConfirmStock] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const dirtyRef = useRef(false)
  const leave = useUnsavedDraftGuard(dirty)

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
      })
    }
  }, [product, draftHydrated])

  async function persistProduct() {
    if (!form.name.trim()) { showToast('Nhập tên sản phẩm', 'bad'); return }
    if (!confirmGate.current.tryEnter()) return
    setSaving(true)
    try {
      if (isNew) {
        await addProduct(form)
        showToast('✓ Đã thêm sản phẩm', 'ok')
      } else {
        await updateProduct(id!, { ...form, name: form.name.trim(), cat: form.cat.trim() })
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

  const stockDelta = !isNew && product && form.stock !== product.stock
    ? form.stock - product.stock
    : null

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

  const set = (k: string, v: string | number) => {
    dirtyRef.current = true
    setDirty(true)
    setForm((f) => ({ ...f, [k]: v }))
  }

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate('/kho')}>
          <ChevronLeft size={20} />
        </button>
        <div className="font-brand text-[17px] font-medium flex-1 text-center" style={{ color: 'var(--ink)' }}>
          {isNew ? 'Thêm sản phẩm' : 'Sửa sản phẩm'}
        </div>
        {!isNew && (
          <button
            className="btn-back !border-down/30"
            onClick={() => (product?.stock ?? 0) <= 0 && setConfirmDel(true)}
            disabled={(product?.stock ?? 0) > 0}
            title={(product?.stock ?? 0) > 0 ? 'Điều chỉnh tồn về 0 rồi mới xóa' : 'Xóa sản phẩm'}
            aria-label="Xóa"
          >
            <Trash2 size={16} style={{ color: 'var(--down)' }} />
          </button>
        )}
        {isNew && <div className="w-9" />}
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4 max-w-[480px] mx-auto w-full">
        {/* Info */}
        {!isNew && product && (
          <div className="card p-4 mb-4 text-sm flex flex-col gap-1">
            <div className="flex justify-between"><span style={{ color: 'var(--mute)' }}>Tồn kho</span><b>{product.stock} {product.unit}</b></div>
            <div className="flex justify-between"><span style={{ color: 'var(--mute)' }}>Lãi/đơn vị</span><b style={{ color: 'var(--up)' }}>{fmt(product.price - product.cost)}</b></div>
            {product.expiry && <div className="flex justify-between"><span style={{ color: 'var(--mute)' }}>HSD</span><span>{expiryText(product.expiry)}</span></div>}
          </div>
        )}

        {/* Form */}
        <div className="flex flex-col gap-3">
          <Field label="Tên sản phẩm *">
            <input className="field-input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="VD: Coca 390ml" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Danh mục">
              <input className="field-input" value={form.cat} onChange={(e) => set('cat', e.target.value)} placeholder="Nước ngọt" />
            </Field>
            <Field label="Đơn vị">
              <input className="field-input" value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder="chai" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Giá bán">
              <input className="field-input" type="number" inputMode="numeric" value={form.price || ''} onChange={(e) => set('price', Number(e.target.value))} />
            </Field>
            <Field label="Giá vốn">
              <input className="field-input" type="number" inputMode="numeric" value={form.cost || ''} onChange={(e) => set('cost', Number(e.target.value))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tồn kho">
              <input className="field-input" type="number" inputMode="numeric" value={form.stock || ''} onChange={(e) => set('stock', Number(e.target.value))} />
            </Field>
            <Field label="Giá sỉ (0 = không)">
              <input className="field-input" type="number" inputMode="numeric" value={form.wholesalePrice || ''} onChange={(e) => set('wholesalePrice', Number(e.target.value))} />
            </Field>
          </div>
          <Field label="Mã vạch">
            <input className="field-input" value={form.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="8934567890123" />
          </Field>
          <Field label="Hạn sử dụng">
            <input className="field-input" type="date" value={form.expiry} onChange={(e) => set('expiry', e.target.value)} />
          </Field>
        </div>

        <button className="btn-cta mt-6" disabled={saving} onClick={handleSave}>
          {saving ? 'Đang lưu…' : isNew ? 'Thêm sản phẩm' : 'Lưu thay đổi'}
        </button>
      </div>

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium" style={{ color: 'var(--mute)' }}>{label}</span>
      {children}
    </label>
  )
}
