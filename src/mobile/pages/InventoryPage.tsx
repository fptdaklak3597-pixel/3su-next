/**
 * 3SU Next — Kho hàng (Inventory)
 * Port từ 16-inventory.js: product list, filters, stock badges, HSD.
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, fmtShort, matchesSearch, expiryStatus } from '@/core/format'
import { lowStockItems, outOfStockItems, inventoryValue, productCategories } from '@/core/domain/inventory'
import { seed500, seedCategories } from '@/core/domain/seed'
import { exportCatalogXlsx, importCatalogXlsx } from '@/web/lib/catalogXlsx'
import { logError } from '@/core/errorLogger'
import { Sheet } from '@/shared/components'
import { Search, Plus, PackagePlus, ClipboardCheck, Sparkles, Tag } from 'lucide-react'
import type { Product } from '@/core/types'

type StockFilter = 'all' | 'low' | 'out'

export function InventoryPage() {
  const navigate = useNavigate()
  const settings = useApp((s) => s.settings)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StockFilter>('all')
  const [cat, setCat] = useState('all')
  const [seedOpen, setSeedOpen] = useState(false)
  const [seedStock, setSeedStock] = useState(0)
  const [seeding, setSeeding] = useState(false)
  const [seedCats, setSeedCats] = useState<{ cat: string; count: number }[]>([])
  const showToast = useApp((s) => s.showToast)
  const importRef = useRef<HTMLInputElement>(null)

  const products = useLiveQuery(
    () => dbx.products.filter((p) => !p.deleted).toArray(),
    [],
    [] as Product[],
  )

  const cats = useMemo(() => productCategories(products), [products])
  useEffect(() => {
    if (!seedOpen) return
    void seedCategories().then(setSeedCats).catch((e) => logError(e, 'seedCategories'))
  }, [seedOpen])
  const lowN = lowStockItems(products, settings.lowStock).length
  const outN = outOfStockItems(products).length
  const totalValue = inventoryValue(products)

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (cat !== 'all' && p.cat !== cat) return false
      if (filter === 'low' && !(p.stock > 0 && p.stock <= settings.lowStock)) return false
      if (filter === 'out' && p.stock > 0) return false
      if (!matchesSearch(p.name + ' ' + p.cat + ' ' + p.barcode, query)) return false
      return true
    }).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }, [products, filter, cat, query, settings.lowStock])

  async function handleExport() {
    try {
      await exportCatalogXlsx(products)
      showToast('✓ Đã xuất Excel', 'ok')
    } catch (e) {
      logError(e, 'kho.xlsx')
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

  async function handleSeed() {
    setSeeding(true)
    try {
      const res = await seed500(seedStock)
      showToast(`✓ Đã thêm ${res.added} mặt hàng${res.skipped ? ` (${res.skipped} trùng, bỏ qua)` : ''}`, 'ok')
      setSeedOpen(false)
    } catch (e) {
      logError(e, 'seed500')
      showToast('Lỗi khi nạp dữ liệu mẫu', 'bad')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <div>
          <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Kho hàng</div>
          <div className="text-xs" style={{ color: 'var(--mute)' }}>
            {filtered.length}/{products.length} món · {fmtShort(totalValue)} vốn
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost text-sm" onClick={() => { void handleExport() }} disabled={products.length === 0}>Xuất</button>
          <button className="btn-ghost text-sm" onClick={() => importRef.current?.click()}>Nhập</button>
          <button className="btn-back" onClick={() => navigate('/kiem-ke')} aria-label="Kiểm kê">
            <ClipboardCheck size={17} />
          </button>
          <button className="btn-back" onClick={() => navigate('/bang-gia-si')} aria-label="Bảng giá sỉ">
            <Tag size={17} />
          </button>
          <button className="btn-back" onClick={() => navigate('/nhap-hang')} aria-label="Nhập hàng">
            <PackagePlus size={17} />
          </button>
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
      </header>

      {/* Search + filters */}
      <div className="px-4 pt-3 pb-2 flex flex-col gap-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--mute-2)' }} />
          <input className="field-input pl-9 text-sm" placeholder="Tìm sản phẩm…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>Tất cả</button>
          <button className={`chip ${filter === 'low' ? 'active' : ''}`} onClick={() => setFilter('low')}>
            Sắp hết{lowN > 0 ? ` (${lowN})` : ''}
          </button>
          <button className={`chip ${filter === 'out' ? 'active' : ''}`} onClick={() => setFilter('out')}>
            Hết hàng{outN > 0 ? ` (${outN})` : ''}
          </button>
          {cats.slice(0, 5).map((c) => (
            <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(cat === c ? 'all' : c)}>{c}</button>
          ))}
        </div>
      </div>

      {/* Product list */}
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {filtered.map((p) => {
          const stockCls = p.stock <= 0 ? 'out' : p.stock <= settings.lowStock ? 'low' : 'ok'
          const exp = expiryStatus(p.expiry, settings.hsdWarnDays)
          return (
            <button key={p.id} className="list-row" onClick={() => navigate(`/kho/${p.id}`)}>
              <div className="w-9 h-9 rounded-[10px] flex items-center justify-center" style={{ background: 'var(--paper)' }}>
                <span className="w-2.5 h-2.5 rounded-full" style={{
                  background: stockCls === 'out' ? 'var(--down)' : stockCls === 'low' ? 'var(--warn)' : 'var(--up)'
                }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium truncate flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
                  {p.name}
                  {exp === 'expired' && <span className="stock-badge out">Hết HSD</span>}
                  {exp === 'soon' && <span className="stock-badge low">HSD gần</span>}
                </div>
                <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--mute)' }}>
                  {fmt(p.price)} · lời {fmt(p.price - p.cost)}{p.cat ? ` · ${p.cat}` : ''}
                </div>
              </div>
              <div className="text-right">
                <span className={`stock-badge ${stockCls}`}>
                  {p.stock <= 0 ? 'Hết' : `${p.stock} ${p.unit}`}
                </span>
              </div>
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-sm flex flex-col items-center gap-3" style={{ color: 'var(--mute)' }}>
            <span>Không có sản phẩm nào</span>
            {products.length < 500 && (
              <button className="btn-ghost flex items-center gap-2" onClick={() => setSeedOpen(true)}>
                <Sparkles size={15} /> Nạp 500 mặt hàng mẫu
              </button>
            )}
          </div>
        )}
        {filtered.length > 0 && products.length < 500 && (
          <button className="btn-ghost w-full mt-3 flex items-center justify-center gap-2 text-[12px]" onClick={() => setSeedOpen(true)}>
            <Sparkles size={14} /> Nạp 500 mặt hàng mẫu giá thị trường
          </button>
        )}
      </div>

      {/* Add product FAB */}
      <div className="absolute bottom-20 right-5">
        <button
          className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg"
          style={{ background: 'var(--ink)', color: 'var(--paper)' }}
          onClick={() => navigate('/kho/new')}
          aria-label="Thêm sản phẩm"
        >
          <Plus size={24} />
        </button>
      </div>
      {/* Seed dialog */}
      <Sheet open={seedOpen} onClose={() => setSeedOpen(false)} title="Nạp 500 mặt hàng mẫu">
        <p className="text-[12.5px] mb-3" style={{ color: 'var(--mute)' }}>
          Thêm nhanh danh mục phổ biến của cửa hàng tạp hoá VN, kèm giá tham khảo thị trường. Tên đã có sẽ được bỏ qua.
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-4 max-h-[26vh] overflow-y-auto">
          {seedCats.map((c) => (
            <div key={c.cat} className="flex items-center justify-between text-[12px]">
              <span style={{ color: 'var(--ink-2)' }}>{c.cat}</span>
              <b style={{ color: 'var(--mute)' }}>{c.count}</b>
            </div>
          ))}
        </div>
        <label className="flex flex-col gap-1 mb-4">
          <span className="text-xs font-medium" style={{ color: 'var(--mute)' }}>Tồn kho ban đầu</span>
          <input className="field-input" type="number" inputMode="numeric" min={0} value={seedStock || ''} placeholder="0" onChange={(e) => setSeedStock(Number(e.target.value) || 0)} />
        </label>
        <button className="btn-cta" disabled={seeding} onClick={handleSeed}>
          {seeding ? 'Đang nạp…' : 'Nạp 500 mặt hàng'}
        </button>
      </Sheet>
    </div>
  )
}
