/**
 * 3SU Next — Màn hình bán hàng (POS)
 * Port từ 14-sale.js: product grid, search, cart, units, wholesale toggle.
 */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { matchesSearch, fmt, fmtShort, vnDaysAgo, vnToday } from '@/core/format'
import {
  bestSellerIds, suggestUnits, cartUnitPrice, salesInDateRange,
  mergeCartLine, setCartLineQty, stockAddWarning, saleUsesWholesale,
} from '@/core/domain/sales'
import { playPosSound } from '@/core/browser/posSound'
import { productCategories } from '@/core/domain/inventory'
import { parseCommand, findProductByName, startListening, voiceSupported, resolveUnitRatio } from '@/core/browser/voice'
import { createBarcodeScan, findProductByBarcode, type ScanHandle } from '@/core/browser/barcode'
import { attachHidBarcode, isBarcodeLike } from '@/core/browser/hidBarcode'
import { Sheet, Modal, ConfirmDialog } from '@/shared/components'
import { useUnsavedDraftGuard } from '@/shared/useUnsavedDraftGuard'
import { Search, Minus, Plus, Trash2, Tag, Mic, ScanLine, Zap, X, ChevronLeft } from 'lucide-react'
import type { Customer, Product } from '@/core/types'

export function SalePage() {
  const navigate = useNavigate()
  const cart = useApp((s) => s.cart)
  const setCart = useApp((s) => s.setCart)
  const wholesaleMode = useApp((s) => s.wholesaleMode)
  const toggleWholesale = useApp((s) => s.toggleWholesale)
  const customerId = useApp((s) => s.customerId)
  const clearCart = useApp((s) => s.clearCart)
  const settings = useApp((s) => s.settings)
  const showToast = useApp((s) => s.showToast)
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('hot')
  const [listening, setListening] = useState(false)
  const [voiceText, setVoiceText] = useState('')
  const [cmdOpen, setCmdOpen] = useState(false)
  const [cmdText, setCmdText] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [scanManual, setScanManual] = useState('')
  const [outPending, setOutPending] = useState<{ p: Product; qty: number; unit: { n: string; r: number } } | null>(null)
  const stopListenRef = useRef<(() => void) | null>(null)
  const scanRef = useRef<ScanHandle | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const products = useLiveQuery(
    () => dbx.products.filter((p) => !p.deleted).toArray(),
    [],
    [] as Product[],
  )
  const sales = useLiveQuery(() => salesInDateRange(vnDaysAgo(29), vnToday()), [], [])
  const customer = useLiveQuery(
    () => (customerId ? dbx.customers.get(customerId) : undefined),
    [customerId],
  ) as Customer | undefined
  const useWs = saleUsesWholesale(wholesaleMode, customer)
  const leave = useUnsavedDraftGuard(cart.length > 0, ['/thanh-toan'])

  // Xếp sản phẩm: bán chạy trước
  const ranked = useMemo(() => {
    const bestIds = bestSellerIds(sales)
    const bestSet = new Set(bestIds)
    const best = bestIds.map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[]
    const rest = products.filter((p) => !bestSet.has(p.id))
    return [...best, ...rest]
  }, [products, sales])

  const cats = useMemo(() => productCategories(products), [products])
  const bestIds = useMemo(() => bestSellerIds(sales), [sales])
  const filtered = useMemo(() => {
    let list = ranked
    if (!query.trim()) {
      if (cat === 'hot') list = ranked.filter((p) => bestIds.includes(p.id))
      else if (cat !== 'all') list = ranked.filter((p) => p.cat === cat)
      if (cat === 'hot' && list.length === 0) list = ranked
    } else {
      list = ranked.filter((p) => matchesSearch(p.name + ' ' + p.cat + ' ' + p.barcode, query))
    }
    return list.slice(0, query.trim() ? 80 : 30)
  }, [ranked, query, cat, bestIds])

  const productsRef = useRef<Product[]>([])
  productsRef.current = products

  const addToCartRaw = useCallback((p: Product, qty = 1, unit?: { n: string; r: number }) => {
    const u = unit || suggestUnits(p)[0]
    playPosSound('scan-ok', settings.soundOn)
    setCart(mergeCartLine(cart, { productId: p.id, qty, unitName: u.n, unitRatio: u.r }))
  }, [cart, setCart, settings.soundOn])

  const addToCart = useCallback((p: Product, qty = 1, unit?: { n: string; r: number }) => {
    const u = unit || suggestUnits(p)[0]
    if (stockAddWarning(p.stock, qty * u.r) === 'out') {
      // Hết tồn: chặn hẳn nếu shop cấm âm kho, không thì hỏi xác nhận trước khi thêm
      if (settings.allowNegativeStock === false) {
        playPosSound('scan-miss', settings.soundOn)
        showToast(p.name + ' hết hàng / không đủ tồn', 'bad')
        return
      }
      setOutPending({ p, qty, unit: u })
      return
    }
    addToCartRaw(p, qty, u)
  }, [settings.allowNegativeStock, settings.soundOn, showToast, addToCartRaw])

  const addToCartRef = useRef(addToCart)
  addToCartRef.current = addToCart

  useEffect(() => attachHidBarcode((code) => {
    const p = findProductByBarcode(code, productsRef.current)
    if (p) { addToCartRef.current(p, 1); showToast('+ ' + p.name, 'ok') }
    else { playPosSound('scan-miss', settings.soundOn); showToast('Chưa có SP mã ' + code, 'bad') }
  }), [showToast, settings.soundOn])

  /** Thêm nhiều món từ câu lệnh (giọng nói / lệnh nhanh). */
  const applyCommand = useCallback((text: string) => {
    const items = parseCommand(text)
    if (!items.length) { showToast('Không hiểu lệnh, thử lại', 'bad'); return }
    let added = 0
    let skipped = 0
    const next = [...cart]
    for (const it of items) {
      const p = findProductByName(it.name, products)
      if (!p) continue
      const u = it.unit
        ? resolveUnitRatio(p, it.unit)
        : (suggestUnits(p)[0] ?? resolveUnitRatio(p))
      if (settings.allowNegativeStock === false && stockAddWarning(p.stock, it.qty * u.r) === 'out') { skipped++; continue }
      const existing = next.find((c) => c.productId === p.id && c.unitName === u.n)
      if (existing) existing.qty += it.qty
      else next.push({ productId: p.id, qty: it.qty, unitName: u.n, unitRatio: u.r })
      added++
    }
    setCart(next)
    if (added > 0) showToast(`✓ Đã thêm ${added} sản phẩm${skipped ? ` · bỏ qua ${skipped} hết hàng` : ''}`, 'ok')
    else if (skipped > 0) showToast(`${skipped} sản phẩm hết hàng`, 'bad')
    else showToast('Không tìm thấy sản phẩm phù hợp', 'bad')
  }, [cart, products, setCart, showToast, settings.allowNegativeStock])

  /* ─── Giọng nói ─── */
  async function handleVoice() {
    if (listening) { stopListenRef.current?.(); return }
    setListening(true)
    setVoiceText('Đang nghe…')
    const stop = await startListening({
      onInterim: (t) => setVoiceText(t || 'Đang nghe…'),
      onFinal: (t) => { setListening(false); setVoiceText(''); applyCommand(t) },
      onError: (msg) => { setListening(false); setVoiceText(''); showToast(msg, 'bad') },
    })
    stopListenRef.current = stop
    if (!stop) { setListening(false); setVoiceText('') }
  }

  /* ─── Mã vạch ─── */
  async function handleScan() {
    setScanOpen(true)
    try {
      const handle = await createBarcodeScan({ onError: (m) => showToast(m, 'bad') })
      scanRef.current = handle
      // chờ video render rồi gắn stream
      setTimeout(() => { if (videoRef.current) handle.attach(videoRef.current) }, 60)
      const value = await handle.promise
      setScanOpen(false)
      scanRef.current = null
      if (!value) return
      const p = findProductByBarcode(value, products)
      if (p) { addToCart(p, 1); showToast('+ ' + p.name, 'ok') }
      else { showToast('Chưa có SP mã ' + value + ' — thêm trong Kho', 'bad') }
    } catch {
      setScanOpen(false)
      scanRef.current = null
    }
  }

  const changeQty = useCallback((idx: number, delta: number) => {
    const item = cart[idx]
    if (!item) return
    setCart(setCartLineQty(cart, idx, item.qty + delta))
  }, [cart, setCart])

  const removeItem = useCallback((idx: number) => {
    setCart(cart.filter((_, i) => i !== idx))
  }, [cart, setCart])

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, ci) => {
      const p = products.find((x) => x.id === ci.productId)
      if (!p) return sum
      return sum + cartUnitPrice(ci, p, useWs) * ci.qty
    }, 0)
  }, [cart, products, useWs])

  const cartCount = cart.reduce((a, c) => a + c.qty, 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="app-hdr bordered">
        <div className="flex items-center gap-2">
          <button className="btn-back" onClick={() => navigate('/')} aria-label="Về trang chủ">
            <ChevronLeft size={18} />
          </button>
          <div>
            <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Bán hàng</div>
            <div className="text-[11px] font-medium tracking-wider uppercase" style={{ color: 'var(--mute)' }}>
              {cartCount > 0 ? `${cartCount} món` : 'Bắt đầu'}
              {wholesaleMode && ' · ĐANG SỈ'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {voiceSupported() && (
            <button className="btn-back" onClick={handleVoice} aria-label="Nhập giọng nói" style={listening ? { color: 'var(--down)' } : {}}>
              <Mic size={18} />
            </button>
          )}
          <button className="btn-back" onClick={handleScan} aria-label="Quét mã vạch">
            <ScanLine size={18} />
          </button>
          <button className="btn-back" onClick={() => setCmdOpen(true)} aria-label="Lệnh nhanh">
            <Zap size={18} />
          </button>
          <button
            className={`btn-ghost text-xs flex items-center gap-1.5 ${wholesaleMode ? '!bg-ink !text-paper' : ''}`}
            onClick={toggleWholesale}
          >
            <Tag size={14} />
            {wholesaleMode ? 'ĐANG SỈ' : 'Giá lẻ'}
          </button>
        </div>
      </header>

      {/* Voice overlay */}
      {listening && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4" style={{ background: 'rgba(28,25,23,0.85)' }} onClick={handleVoice}>
          <div className="text-5xl animate-pulse">🎙️</div>
          <div className="text-base font-medium text-center px-8" style={{ color: 'var(--paper)' }}>{voiceText}</div>
          <div className="text-xs" style={{ color: 'var(--mute-2)' }}>"Hai gói mì, một chai xì dầu" · chạm để dừng</div>
        </div>
      )}

      {/* Barcode scanner modal */}
      <Modal open={scanOpen} onClose={() => { scanRef.current?.cancel(); setScanOpen(false) }}>
        <div className="flex flex-col items-center gap-3">
          <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Hướng camera vào mã vạch</div>
          <video ref={videoRef} className="w-full rounded-xl" style={{ maxHeight: 280, background: '#000' }} playsInline muted />
          <input
            className="field-input"
            placeholder="Gõ mã nếu camera không bắt"
            value={scanManual}
            onChange={(e) => setScanManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && scanManual.trim()) {
                const p = findProductByBarcode(scanManual.trim(), products)
                if (p) { addToCart(p, 1); showToast('+ ' + p.name, 'ok') }
                else showToast('Không thấy mã', 'bad')
                setScanManual('')
              }
            }}
          />
          <button className="btn-ghost flex items-center justify-center gap-2" onClick={() => { scanRef.current?.cancel(); setScanOpen(false) }}>
            <X size={15} /> Đóng
          </button>
        </div>
      </Modal>

      {/* Quick command sheet */}
      <Sheet open={cmdOpen} onClose={() => setCmdOpen(false)} title="Lệnh nhanh">
        <div className="flex flex-col gap-3">
          <textarea
            className="field-input min-h-[80px] resize-none"
            placeholder='Ví dụ: "3 mì, 1 coca" hoặc "2 trứng, 1 sữa"'
            value={cmdText}
            onChange={(e) => setCmdText(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2 flex-wrap">
            {['3 mì, 1 coca', '2 trứng, 1 sữa', '1 bia, 2 nước ngọt'].map((s) => (
              <button key={s} className="chip" onClick={() => setCmdText(s)}>{s}</button>
            ))}
          </div>
          <button className="btn-cta" onClick={() => { if (cmdText.trim()) applyCommand(cmdText); setCmdText(''); setCmdOpen(false) }}>
            Thực hiện
          </button>
        </div>
      </Sheet>

      {/* Search */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
          <button className={`chip ${cat === 'hot' ? '!bg-ink !text-paper' : ''}`} onClick={() => setCat('hot')}>Bán chạy</button>
          <button className={`chip ${cat === 'all' ? '!bg-ink !text-paper' : ''}`} onClick={() => setCat('all')}>Tất cả</button>
          {cats.slice(0, 8).map((c) => (
            <button key={c} className={`chip ${cat === c ? '!bg-ink !text-paper' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--mute-2)' }} />
          <input
            className="field-input pl-10 text-sm"
            placeholder="Tìm sản phẩm, mã vạch…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !isBarcodeLike(query)) return
              const p = findProductByBarcode(query, products)
              if (p) { addToCart(p, 1); setQuery(''); showToast('+ ' + p.name, 'ok') }
              else { playPosSound('scan-miss', settings.soundOn); showToast('Chưa có SP mã ' + query.trim(), 'bad') }
            }}
            type="search"
            inputMode="search"
          />
        </div>
      </div>

      {/* Product list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="section-label">{query ? 'Kết quả tìm kiếm' : 'Sản phẩm bán nhanh'}</div>
        <div className="flex flex-col gap-1.5">
          {filtered.map((p) => {
            const extra = suggestUnits(p).filter((u) => u.r > 1)
            const price = useWs && p.wholesalePrice > 0 ? p.wholesalePrice : p.price
            return (
              <div key={p.id} className="sale-item">
                <button type="button" className="sale-item-hit" onClick={() => addToCart(p)}>
                  <span
                    className="sale-item-dot"
                    style={{ background: p.stock <= 0 ? 'var(--down)' : p.stock <= settings.lowStock ? 'var(--warn)' : 'var(--up)' }}
                  />
                  <div className="sale-item-text">
                    <div className="sale-item-name">{p.name}</div>
                    <div className="sale-item-meta">
                      {p.cat || '—'} · còn {p.stock} {p.unit}{p.stock <= 0 ? ' · HẾT' : ''}
                    </div>
                  </div>
                </button>
                <div className="sale-item-units" data-empty={extra.length === 0 ? '' : undefined}>
                  {extra.map((u) => (
                    <button key={u.n} type="button" className="sale-unit-chip" onClick={() => addToCart(p, 1, u)}>
                      <span className="sale-unit-n">{u.n}</span>
                      <span className="sale-unit-x">×{u.r}</span>
                    </button>
                  ))}
                </div>
                <div className="sale-item-foot">
                  <span className="sale-item-price stat-num">{fmtShort(price)}đ</span>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--mute)' }}>
              Không tìm thấy sản phẩm
            </div>
          )}
        </div>
      </div>

      {/* Cart bar */}
      {cart.length > 0 && (
        <div className="border-t px-4 py-3" style={{ borderColor: 'var(--hair)', background: 'var(--paper)' }}>
          {/* Cart items compact */}
          <div className="max-h-[180px] overflow-y-auto mb-3 flex flex-col gap-2">
            {cart.map((ci, idx) => {
              const p = products.find((x) => x.id === ci.productId)
              if (!p) return null
              const unitPrice = cartUnitPrice(ci, p, useWs)
              return (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate" style={{ color: 'var(--ink)' }}>{p.name}</div>
                    <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
                      {fmt(unitPrice)} / {ci.unitName}
                      {settings.showCostInCart && ` · vốn ${fmt(p.cost * ci.unitRatio)}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button className="qty-btn" onClick={() => changeQty(idx, -1)}>
                      <Minus size={16} />
                    </button>
                    <input
                      className="w-8 text-center text-sm font-medium bg-transparent"
                      type="number"
                      min={0}
                      value={ci.qty}
                      onChange={(e) => setCart(setCartLineQty(cart, idx, Number(e.target.value) || 0))}
                    />
                    <button className="qty-btn" onClick={() => changeQty(idx, 1)}>
                      <Plus size={16} />
                    </button>
                  </div>
                  <div className="w-16 text-right text-[13px] font-medium stat-num" style={{ color: 'var(--ink)' }}>
                    {fmtShort(unitPrice * ci.qty)}
                  </div>
                  <button className="text-mute-2 p-1" onClick={() => removeItem(idx)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Total + checkout */}
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => clearCart()}>Xóa giỏ</button>
            <button className="btn-cta flex-[2]" onClick={() => navigate({ pathname: '/thanh-toan', search: window.location.search })}>
              <span>Thanh toán · {fmt(cartTotal)}</span>
            </button>
          </div>
        </div>
      )}

      {/* Xác nhận khi thêm món hết tồn (shop vẫn cho âm kho) */}
      <ConfirmDialog
        open={!!outPending}
        title="Hết hàng"
        message={`${outPending?.p.name ?? ''} còn ${outPending?.p.stock ?? 0} trong kho. Thêm vào giỏ sẽ làm âm kho.`}
        confirmLabel="Vẫn thêm"
        onConfirm={() => {
          if (outPending) addToCartRaw(outPending.p, outPending.qty, outPending.unit)
          setOutPending(null)
        }}
        onCancel={() => setOutPending(null)}
      />
      {leave.dialog}
    </div>
  )
}
