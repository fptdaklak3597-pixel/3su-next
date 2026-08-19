/**
 * Thêm / sửa sản phẩm web.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { addProduct, deleteProduct, updateProduct } from '@/core/domain/inventory'
import { expiryText, fmt } from '@/core/format'
import { logError } from '@/core/errorLogger'
import { ConfirmDialog } from '@/shared/components'
import type { PriceLogEntry } from '@/core/types'

function PriceLogCard({ productId }: { productId: string }) {
  const logs = useLiveQuery(
    () => dbx.priceLog.where('productId').equals(productId).toArray(),
    [productId],
    [] as PriceLogEntry[],
  )
  const sorted = [...logs].sort((a, b) => b.ts - a.ts)
  if (!sorted.length) return null
  return (
    <div className="web-card" style={{ maxWidth: 720, marginTop: 12 }}>
      <h3>Nhật ký giá nhập</h3>
      {sorted.slice(0, 12).map((l) => (
        <div key={l.id} className="web-ln">
          <span>{l.supName || 'NCC'} · {new Date(l.ts).toLocaleDateString('vi-VN')}</span>
          <span>{fmt(l.cost)}</span>
        </div>
      ))}
    </div>
  )
}

export function WebProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const isNew = id === 'new'
  const product = useLiveQuery(() => (!isNew && id ? dbx.products.get(id) : undefined), [id, isNew])

  const [form, setForm] = useState({
    name: '', cat: '', price: 0, cost: 0, stock: 0, unit: 'cái', barcode: '', expiry: '', wholesalePrice: 0,
    pack1n: '', pack1r: 0, pack2n: '', pack2r: 0,
  })
  const [confirmDel, setConfirmDel] = useState(false)
  const dirtyRef = useRef(false)
  const set = (k: string, v: string | number) => {
    dirtyRef.current = true
    setForm((f) => ({ ...f, [k]: v }))
  }

  useEffect(() => { dirtyRef.current = false }, [id])

  useEffect(() => {
    if (product && !dirtyRef.current) {
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
  }, [product])

  async function handleSave() {
    if (!form.name.trim()) { showToast('Nhập tên sản phẩm', 'bad'); return }
    const units = [
      form.pack1n.trim() && form.pack1r > 1 ? { n: form.pack1n.trim(), r: form.pack1r } : null,
      form.pack2n.trim() && form.pack2r > 1 ? { n: form.pack2n.trim(), r: form.pack2r } : null,
    ].filter(Boolean) as { n: string; r: number }[]
    try {
      if (isNew) {
        await addProduct({
          name: form.name, cat: form.cat, price: form.price, cost: form.cost,
          stock: form.stock, unit: form.unit, barcode: form.barcode,
          expiry: form.expiry, wholesalePrice: form.wholesalePrice, units,
        })
        showToast('✓ Đã thêm sản phẩm', 'ok')
      } else {
        await updateProduct(id!, { name: form.name.trim(), cat: form.cat.trim(), price: form.price, cost: form.cost, stock: form.stock, unit: form.unit, barcode: form.barcode, expiry: form.expiry, wholesalePrice: form.wholesalePrice, units })
        showToast('✓ Đã lưu', 'ok')
      }
      navigate('/kho')
    } catch (e) {
      logError(e, 'product.save')
      showToast('Lỗi khi lưu', 'bad')
    }
  }

  async function handleDelete() {
    try {
      await deleteProduct(id!)
      showToast('Đã xóa sản phẩm', 'ok')
      navigate('/kho')
    } catch (e) {
      logError(e, 'product.delete')
      showToast('Lỗi khi xóa', 'bad')
    }
  }

  return (
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>{isNew ? 'Thêm sản phẩm' : 'Sửa sản phẩm'}</h2>
          {!isNew && product && (
            <p>Tồn {product.stock} {product.unit} · lãi {fmt(product.price - product.cost)}{product.expiry ? ` · ${expiryText(product.expiry)}` : ''}</p>
          )}
        </div>
        <div className="web-ph-actions">
          <button className="web-btn" onClick={() => navigate('/kho')}>Hàng hóa</button>
          {!isNew && <button className="web-btn danger" onClick={() => setConfirmDel(true)}>Xóa</button>}
          <button className="web-btn pri" onClick={handleSave}>{isNew ? 'Thêm' : 'Lưu'}</button>
        </div>
      </div>

      <div className="web-card" style={{ maxWidth: 720 }}>
        <div className="web-form-grid">
          <label className="web-field" style={{ gridColumn: '1 / -1' }}>
            <span>Tên sản phẩm *</span>
            <input className="web-input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="VD: Gạo ST25 5kg" />
          </label>
          <label className="web-field">
            <span>Nhóm hàng</span>
            <input className="web-input" value={form.cat} onChange={(e) => set('cat', e.target.value)} />
          </label>
          <label className="web-field">
            <span>Đơn vị</span>
            <input className="web-input" value={form.unit} onChange={(e) => set('unit', e.target.value)} />
          </label>
          <label className="web-field">
            <span>Giá bán</span>
            <input className="web-input" type="number" value={form.price || ''} onChange={(e) => set('price', Number(e.target.value))} />
          </label>
          <label className="web-field">
            <span>Giá vốn</span>
            <input className="web-input" type="number" value={form.cost || ''} onChange={(e) => set('cost', Number(e.target.value))} />
          </label>
          <label className="web-field">
            <span>Tồn kho</span>
            <input className="web-input" type="number" value={form.stock || ''} onChange={(e) => set('stock', Number(e.target.value))} />
          </label>
          <label className="web-field">
            <span>Giá sỉ (0 = không)</span>
            <input className="web-input" type="number" value={form.wholesalePrice || ''} onChange={(e) => set('wholesalePrice', Number(e.target.value))} />
          </label>
          <label className="web-field">
            <span>Mã vạch</span>
            <input className="web-input" value={form.barcode} onChange={(e) => set('barcode', e.target.value)} />
          </label>
          <label className="web-field">
            <span>Hạn sử dụng</span>
            <input className="web-input" type="date" value={form.expiry} onChange={(e) => set('expiry', e.target.value)} />
          </label>
          <label className="web-field">
            <span>Đơn vị phụ 1 (vd thùng)</span>
            <input className="web-input" value={form.pack1n} onChange={(e) => set('pack1n', e.target.value)} placeholder="thùng" />
          </label>
          <label className="web-field">
            <span>Hệ số 1 (vd 24)</span>
            <input className="web-input" type="number" value={form.pack1r || ''} onChange={(e) => set('pack1r', Number(e.target.value))} />
          </label>
          <label className="web-field">
            <span>Đơn vị phụ 2 (vd lốc)</span>
            <input className="web-input" value={form.pack2n} onChange={(e) => set('pack2n', e.target.value)} placeholder="lốc" />
          </label>
          <label className="web-field">
            <span>Hệ số 2</span>
            <input className="web-input" type="number" value={form.pack2r || ''} onChange={(e) => set('pack2r', Number(e.target.value))} />
          </label>
        </div>
        {!isNew && <p className="web-sub" style={{ marginTop: 12 }}>Đổi tồn sẽ ghi điều chỉnh (cộng diff), không thay phiếu nhập / kiểm kê.</p>}
      </div>

      {!isNew && id && <PriceLogCard productId={id} />}

      <ConfirmDialog
        open={confirmDel}
        title="Xóa sản phẩm?"
        message={`"${product?.name}" sẽ bị xóa khỏi kho. Lịch sử bán hàng vẫn giữ nguyên.`}
        confirmLabel="Xóa"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  )
}
