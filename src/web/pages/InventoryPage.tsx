/**
 * Kho web — lọc trái + bảng + phân trang (khung đã chốt).
 */
import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, fmtShort, expiryStatus, daysToExpiry } from '@/core/format'
import { inventoryValue, productCategories, forecastStock } from '@/core/domain/inventory'
import { WebSeedSheet } from '@/web/components/WebSeedSheet'
import { logError } from '@/core/errorLogger'
import { filterProducts, paginate, type StockFilter } from '@/web/lib/listFilters'
import { exportCatalogXlsx, importCatalogXlsx } from '@/web/lib/catalogXlsx'
import { WebEmpty } from '@/web/components/WebEmpty'
import type { Product, Sale } from '@/core/types'

export function WebInventoryPage() {
  const navigate = useNavigate()
  const settings = useApp((s) => s.settings)
  const showToast = useApp((s) => s.showToast)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StockFilter>('all')
  const [cat, setCat] = useState('')
  const [catQ, setCatQ] = useState('')
  const [page, setPage] = useState(1)
  const [seedOpen, setSeedOpen] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const products = useLiveQuery(
    () => dbx.products.filter((p) => !p.deleted).toArray(),
    [],
    [] as Product[],
  )
  const sales = useLiveQuery(() => dbx.sales.toArray(), [], [] as Sale[])

  const cats = useMemo(() => productCategories(products), [products])
  const catCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of products) {
      if (!p.cat) continue
      m.set(p.cat, (m.get(p.cat) ?? 0) + 1)
    }
    return m
  }, [products])
  const visibleCats = useMemo(() => {
    const q = catQ.trim().toLowerCase()
    if (!q) return cats
    return cats.filter((c) => c.toLowerCase().includes(q))
  }, [cats, catQ])
  const fcMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of forecastStock(products, sales)) m.set(f.productId, f.daysLeft)
    return m
  }, [products, sales])

  const filtered = useMemo(
    () => filterProducts(products, {
      query, filter, cat, lowStock: settings.lowStock, hsdWarnDays: settings.hsdWarnDays,
    }),
    [products, query, filter, cat, settings.lowStock, settings.hsdWarnDays],
  )

  const lowN = products.filter((p) => p.stock > 0 && p.stock <= settings.lowStock).length
  const outN = products.filter((p) => p.stock <= 0).length
  const hsdN = products.filter((p) => {
    const s = expiryStatus(p.expiry, settings.hsdWarnDays)
    return s === 'soon' || s === 'expired'
  }).length
  const totalValue = inventoryValue(products)
  const { rows, pages } = paginate(filtered, page, 15)

  function setStock(next: StockFilter) {
    setFilter(next)
    setPage(1)
  }

  async function handleExport() {
    try {
      await exportCatalogXlsx(products)
      showToast('✓ Đã xuất Excel', 'ok')
    } catch (e) {
      logError(e, 'catalog.export')
      showToast('Lỗi khi xuất Excel', 'bad')
    }
  }

  async function handleImport(file: File) {
    try {
      const res = await importCatalogXlsx(file, products)
      const err = res.errors.slice(0, 3).map((e) => `dòng ${e.row}: ${e.message}`).join(' · ')
      showToast(
        `Nhập xong: +${res.added} · sửa ${res.updated}${res.skipped ? ` · bỏ ${res.skipped}` : ''}${err ? ` · ${err}` : ''}`,
        res.errors.length ? 'bad' : 'ok',
      )
    } catch (e) {
      logError(e, 'catalog.import')
      showToast('Lỗi khi nhập Excel', 'bad')
    }
  }

  return (
    <div className="web-page">
      <div className="web-ph">
        <h2>Hàng hóa</h2>
        <input
          className="web-search"
          style={{ paddingLeft: 12, maxWidth: 360, flex: 1 }}
          placeholder="Theo mã, tên hàng"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1) }}
        />
        <div className="web-ph-actions">
          {products.length < 500 && (
            <button className="web-btn" onClick={() => setSeedOpen(true)}>Nạp mẫu</button>
          )}
          <button className="web-btn" onClick={handleExport} disabled={products.length === 0}>Xuất Excel</button>
          <button className="web-btn" onClick={() => importRef.current?.click()}>Nhập Excel</button>
          <button className="web-btn" onClick={() => navigate('/nhap-hang')}>Nhập hàng</button>
          <button className="web-btn pri" onClick={() => navigate('/kho/new')}>+ Thêm mới</button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void handleImport(f)
          }}
        />
      </div>
      <p className="web-sub">{products.length} món · vốn {fmtShort(totalValue)} · {lowN} sắp hết · {hsdN} gần HSD</p>
      {products.length === 0 && (
        <WebEmpty title="Chưa có hàng hóa" sub="Thêm vài món thật hoặc nạp mẫu, rồi bán đơn đầu từ Bán hàng.">
          <button className="web-btn" onClick={() => setSeedOpen(true)}>Nạp mẫu 500</button>
          <button className="web-btn pri" onClick={() => navigate('/kho/new')}>+ Thêm hàng</button>
          <button className="web-btn" onClick={() => importRef.current?.click()}>Nhập Excel</button>
        </WebEmpty>
      )}

      <div className="web-hang">
        <aside className="web-filters">
          <div className="fg">
            <b>Tồn kho</b>
            <div className="web-f-pills" role="group" aria-label="Tồn kho">
              <button type="button" className={filter === 'all' ? 'on' : ''} aria-pressed={filter === 'all'} onClick={() => setStock('all')}>
                Tất cả <em>{products.length}</em>
              </button>
              <button type="button" className={filter === 'low' ? 'on' : ''} aria-pressed={filter === 'low'} onClick={() => setStock('low')}>
                Dưới ĐM <em>{lowN}</em>
              </button>
              <button type="button" className={filter === 'out' ? 'on' : ''} aria-pressed={filter === 'out'} onClick={() => setStock('out')}>
                Hết hàng <em>{outN}</em>
              </button>
              <button type="button" className={filter === 'hsd' ? 'on' : ''} aria-pressed={filter === 'hsd'} onClick={() => setStock('hsd')}>
                Gần HSD <em>{hsdN}</em>
              </button>
            </div>
          </div>
          <div className="fg">
            <b>Nhóm hàng</b>
            {cats.length > 8 && (
              <input
                className="web-f-search"
                placeholder="Tìm nhóm"
                value={catQ}
                onChange={(e) => setCatQ(e.target.value)}
              />
            )}
            <div className="web-f-list" role="listbox" aria-label="Nhóm hàng">
              <button type="button" role="option" aria-selected={cat === ''} className={cat === '' ? 'on' : ''} onClick={() => { setCat(''); setPage(1) }}>
                <span>Tất cả</span><em>{products.length}</em>
              </button>
              {visibleCats.map((c) => (
                <button key={c} type="button" role="option" aria-selected={cat === c} className={cat === c ? 'on' : ''} onClick={() => { setCat(c); setPage(1) }}>
                  <span>{c}</span><em>{catCount.get(c) ?? 0}</em>
                </button>
              ))}
              {visibleCats.length === 0 && <p className="web-f-empty">Không có nhóm khớp</p>}
            </div>
          </div>
        </aside>

        <div>
          <div className="web-table-wrap">
            <table className="web-table">
              <thead>
                <tr>
                  <th>Mã hàng</th>
                  <th>Tên hàng</th>
                  <th>Giá bán</th>
                  <th>Tồn</th>
                  <th>Dự kiến hết</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const days = fcMap.get(p.id)
                  const exp = expiryStatus(p.expiry, settings.hsdWarnDays)
                  const hsd = daysToExpiry(p.expiry)
                  return (
                    <tr key={p.id} onClick={() => navigate(`/kho/${p.id}`)}>
                      <td>{p.barcode || p.id.slice(-6)}</td>
                      <td>
                        {p.name}
                        {p.stock <= 0 && <span className="web-badge out ml-2">Hết</span>}
                        {p.stock > 0 && p.stock <= settings.lowStock && <span className="web-badge low ml-2">Sắp hết</span>}
                        {exp === 'expired' && <span className="web-badge out ml-2">Hết HSD</span>}
                        {exp === 'soon' && <span className="web-badge low ml-2">HSD {hsd}n</span>}
                      </td>
                      <td>{fmt(p.price)}</td>
                      <td>{p.stock} {p.unit}</td>
                      <td>{days === undefined ? '—' : days === Infinity ? '—' : `${days} ngày`}</td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="web-table-empty">Không có sản phẩm</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="web-foot">
            <span>Hiển thị {filtered.length === 0 ? 0 : (page - 1) * 15 + 1}–{Math.min(page * 15, filtered.length)} / {filtered.length} hàng</span>
            {pages > 1 && (
              <span>
                <button className="web-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button>
                {' '}
                <button className="web-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau</button>
              </span>
            )}
          </div>
        </div>
      </div>
      <WebSeedSheet open={seedOpen} onClose={() => setSeedOpen(false)} />
    </div>
  )
}
