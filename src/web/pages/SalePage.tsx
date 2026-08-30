/**
 * POS web — danh sách ngang + giỏ phải, thanh toán ngay trên màn.
 */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { matchesSearch, fmt, fmtNum, vnDaysAgo, vnToday } from '@/core/format'
import {
  bestSellerIds, suggestUnits, cartUnitPrice, checkoutFingerprint, confirmCheckoutSale, maybeQueueEinvoiceForSale, customerHabits,
  mergeCartLine, setCartLineQty, removeCartLine, discountToAmount, effectiveCashTendered, stockAddWarning,
  salesInDateRange, DENOMINATIONS, type CartItem, saleUsesWholesale,
} from '@/core/domain/sales'
import { playPosSound } from '@/core/browser/posSound'
import { PrintStatusDot } from '@/shared/PrintStatus'
import { parseCommand, findProductByName, startListening, voiceSupported, resolveUnitRatio } from '@/core/browser/voice'
import { createBarcodeScan, findProductByBarcode, type ScanHandle } from '@/core/browser/barcode'
import { attachHidBarcode, isBarcodeLike } from '@/core/browser/hidBarcode'
import { dispatchPrint, printResultToast } from '@/core/browser/printQueue'
import { canUseBluetoothPrint, printTicketBluetooth } from '@/core/browser/printBluetooth'
import { saleTicketFromContext } from '@/core/browser/printTicket'
import { createConfirmGate } from '@/core/confirmGate'
import { printReceiptLocal } from '@/core/browser/print'
import { payQrSrc } from '@/core/domain/vietqr'
import { productCategories } from '@/core/domain/inventory'
import { Sheet, Modal, ConfirmDialog } from '@/shared/components'
import { Search, Minus, Plus, Mic, ScanLine, Zap, X, Printer } from 'lucide-react'
import type { Product, Customer, PayMethod, Sale } from '@/core/types'
import { logError } from '@/core/errorLogger'
import { useUnsavedDraftGuard } from '@/shared/useUnsavedDraftGuard'

export function WebSalePage() {
  const navigate = useNavigate()
  const cart = useApp((s) => s.cart)
  const setCart = useApp((s) => s.setCart)
  const clearCart = useApp((s) => s.clearCart)
  const wholesaleMode = useApp((s) => s.wholesaleMode)
  const toggleWholesale = useApp((s) => s.toggleWholesale)
  const customerId = useApp((s) => s.customerId)
  const setCustomerId = useApp((s) => s.setCustomerId)
  const discount = useApp((s) => s.discount)
  const setDiscount = useApp((s) => s.setDiscount)
  const discountKind = useApp((s) => s.discountKind)
  const setDiscountKind = useApp((s) => s.setDiscountKind)
  const payMethod = useApp((s) => s.payMethod)
  const setPayMethod = useApp((s) => s.setPayMethod)
  const settings = useApp((s) => s.settings)
  const showToast = useApp((s) => s.showToast)
  const celebrate = useApp((s) => s.celebrate)
  const shop = useApp((s) => s.shop)
  const user = useApp((s) => s.user)
  const tendered = useApp((s) => s.tendered)
  const setTendered = useApp((s) => s.setTendered)
  const cashEntered = useApp((s) => s.cashEntered)
  const setCashEntered = useApp((s) => s.setCashEntered)

  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('hot')
  const [listening, setListening] = useState(false)
  const [voiceText, setVoiceText] = useState('')
  const [cmdOpen, setCmdOpen] = useState(false)
  const [cmdText, setCmdText] = useState('')
  const [scanManual, setScanManual] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [outPending, setOutPending] = useState<{ p: Product; qty: number; unit: { n: string; r: number } } | null>(null)
  const [custOpen, setCustOpen] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [doneSale, setDoneSale] = useState<{ sale: Sale; customerName: string | null } | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const stopListenRef = useRef<(() => void) | null>(null)
  const confirmGate = useRef(createConfirmGate())
  const idempKeyRef = useRef<string | null>(null)
  const scanRef = useRef<ScanHandle | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const products = useLiveQuery(
    () => dbx.products.filter((p) => !p.deleted).toArray(),
    [],
    [] as Product[],
  )
  const sales = useLiveQuery(() => salesInDateRange(vnDaysAgo(29), vnToday()), [], [])
  const customers = useLiveQuery(
    () => dbx.customers.filter((c) => !c.deleted).toArray(),
    [],
    [] as Customer[],
  )

  const customer = customerId ? customers.find((c) => c.id === customerId) : null
  const useWs = saleUsesWholesale(wholesaleMode, customer)
  const cats = useMemo(() => productCategories(products), [products])

  const ranked = useMemo(() => {
    const bestIds = bestSellerIds(sales)
    const bestSet = new Set(bestIds)
    const best = bestIds.map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[]
    const rest = products.filter((p) => !bestSet.has(p.id))
    return { best, rest, all: [...best, ...rest] }
  }, [products, sales])

  const filtered = useMemo(() => {
    let list = ranked.all
    if (cat === 'hot') list = ranked.best.length ? ranked.best : ranked.all
    else if (cat !== 'all') list = list.filter((p) => p.cat === cat)
    const q = query.trim()
    if (q) list = ranked.all.filter((p) => matchesSearch(p.name + ' ' + p.cat + ' ' + p.barcode, q))
    return list.slice(0, 80)
  }, [ranked, cat, query])

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

  const productsRef = useRef(products)
  productsRef.current = products
  const addToCartRef = useRef(addToCart)
  addToCartRef.current = addToCart

  function addByBarcode(raw: string): boolean {
    const p = findProductByBarcode(raw, productsRef.current)
    if (!p) {
      playPosSound('scan-miss', settings.soundOn)
      showToast('Chưa có SP mã ' + raw, 'bad')
      return false
    }
    addToCartRef.current(p, 1)
    setQuery('')
    showToast('+ ' + p.name, 'ok')
    return true
  }

  useEffect(() => attachHidBarcode((code) => { addByBarcode(code) }), [showToast])

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

  async function handleScan() {
    setScanOpen(true)
    try {
      const handle = await createBarcodeScan({ onError: (m) => showToast(m, 'bad') })
      scanRef.current = handle
      setTimeout(() => { if (videoRef.current) handle.attach(videoRef.current) }, 60)
      const value = await handle.promise
      setScanOpen(false)
      scanRef.current = null
      if (!value) return
      const p = findProductByBarcode(value, products)
      if (p) { addToCart(p, 1); showToast('+ ' + p.name, 'ok') }
      else showToast('Chưa có SP mã ' + value, 'bad')
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

  function changeUnit(idx: number, unit: { n: string; r: number }) {
    const item = cart[idx]
    if (!item) return
    setCart(mergeCartLine(removeCartLine(cart, idx), { ...item, unitName: unit.n, unitRatio: unit.r }))
  }

  const subtotal = useMemo(() => cart.reduce((sum, ci) => {
    const p = products.find((x) => x.id === ci.productId)
    return p ? sum + cartUnitPrice(ci, p, useWs) * ci.qty : sum
  }, 0), [cart, products, useWs])

  const discountAmt = discountToAmount(subtotal, discount, discountKind)
  const final = Math.max(0, subtotal - discountAmt)
  const isDebt = payMethod === 'debt'
  const cash = effectiveCashTendered({ payMethod, total: final, tendered, cashEntered })
  const effectiveTendered = cash.tendered
  const change = cash.change
  const debtAmount = cash.debtAmount
  const canConfirm = cart.length > 0
    && !cash.needsCashEntry
    && (debtAmount === 0 || !!customerId)
  const leave = useUnsavedDraftGuard(cart.length > 0)

  const cartFingerprint = checkoutFingerprint({
    items: cart,
    discount: discountAmt,
    payMethod,
    tendered: effectiveTendered,
    customerId,
    wholesale: useWs,
  })
  useEffect(() => { idempKeyRef.current = null }, [cartFingerprint])

  async function handleConfirm() {
    if (!canConfirm) return
    if (!confirmGate.current.tryEnter()) return
    setProcessing(true)
    try {
      if (!idempKeyRef.current) idempKeyRef.current = cartFingerprint
      const result = await confirmCheckoutSale({
        items: cart,
        products,
        discount: discountAmt,
        payMethod,
        tendered: effectiveTendered,
        customerId,
        wholesale: useWs,
        idempotencyKey: idempKeyRef.current,
      })
      if (result.status === 'pending') {
        showToast(result.banner, 'bad')
        return
      }
      const { sale, warnings } = result
      void maybeQueueEinvoiceForSale(sale)
      playPosSound('sale', settings.soundOn)
      celebrate(sale.total, `Hay lắm${shop.name ? ' ' + shop.name.split(' ').slice(-1)[0] : ''}!`, 1000)
      showToast(
        '✓ Đã chốt đơn ' + fmt(sale.total) + (warnings[0] ? ' · ' + warnings[0] : ''),
        warnings.length ? 'warn' : 'ok',
      )
      const customerName = customerId ? customers.find((c) => c.id === customerId)?.name ?? null : null
      setDoneSale({ sale, customerName })
      clearCart()
      const printed = await dispatchPrint({
        sale,
        shop,
        printer: settings.printer,
        customerName,
        cashier: user?.name || user?.username || '',
      })
      if (printed.via !== 'none') {
        const t = printResultToast(printed)
        showToast(t.text, t.kind)
      }
    } catch (e) {
      logError(e, 'web.sale.confirm')
      showToast(e instanceof Error ? e.message : 'Lỗi khi chốt đơn', 'bad')
    } finally {
      setProcessing(false)
      confirmGate.current.leave()
    }
  }

  const methods: { id: PayMethod; label: string }[] = [
    { id: 'cash', label: 'Tiền mặt' },
    { id: 'transfer', label: 'Chuyển khoản' },
    { id: 'debt', label: 'Ghi nợ' },
  ]

  return (
    <div className="web-pos">
      <div className="web-pos-bar">
        <button className="web-logo" style={{ fontSize: 15 }} onClick={() => navigate('/')}>3SU</button>
        <div className="web-m on" style={{ height: 30 }}>Bán hàng</div>
        <div className={`web-price-mode ${useWs ? 'is-ws' : 'is-retail'}`} role="group" aria-label="Chế độ giá">
          <button
            type="button"
            className={`web-price-mode-btn ${!useWs ? 'on' : ''}`}
            onClick={() => useWs && toggleWholesale()}
          >
            Giá lẻ
          </button>
          <button
            type="button"
            className={`web-price-mode-btn ${useWs ? 'on' : ''}`}
            onClick={() => !useWs && toggleWholesale()}
          >
            Giá sỉ
          </button>
        </div>
        <div className="web-bar-r">
          <PrintStatusDot />
          {voiceSupported() && (
            <button className="web-ico" onClick={handleVoice} title="Giọng nói"><Mic size={16} /></button>
          )}
          <button className="web-ico" onClick={handleScan} title="Quét mã"><ScanLine size={16} /></button>
          <button className="web-ico" onClick={() => setCmdOpen(true)} title="Lệnh nhanh"><Zap size={16} /></button>
          <button className="web-field" onClick={() => setCustOpen(true)}>
            {customer ? customer.name : 'Khách lẻ'} ▾
          </button>
        </div>
      </div>

      <div className="web-pos-body">
        <div className="web-pos-l">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--kv-subtle)' }} />
            <input
              className="web-search"
              placeholder="Tìm tên / mã vạch — súng quét không cần focus"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isBarcodeLike(query)) addByBarcode(query)
              }}
              autoFocus
            />
          </div>
          {customerId && (
            <div className="web-chips" style={{ marginTop: 8 }}>
              {customerHabits(sales, customerId).slice(0, 3).map((h) => {
                const p = products.find((x) => x.id === h.productId)
                if (!p) return null
                return (
                  <button key={h.productId} type="button" className="web-chip" onClick={() => addToCart(p)}>
                    Hay mua: {p.name}
                  </button>
                )
              })}
            </div>
          )}
          <div className="web-chips" style={{ marginTop: 8 }}>
            <button className={`web-chip ${cat === 'hot' ? 'on' : ''}`} onClick={() => setCat('hot')}>Bán chạy</button>
            <button className={`web-chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>Tất cả</button>
            {cats.slice(0, 8).map((c) => (
              <button key={c} className={`web-chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
          <div className={`web-plist ${query.trim() ? 'is-list' : 'is-tiles'}`}>
            {filtered.map((p) => {
              const price = useWs && p.wholesalePrice > 0 ? p.wholesalePrice : p.price
              const units = suggestUnits(p)
              const extra = units.filter((u) => u.r > 1)
              return (
                <div key={p.id} className="web-pc">
                  <button type="button" className="web-pc-hit n" style={{ flex: 1, textAlign: 'left', background: 'none', border: 0, cursor: 'pointer' }} onClick={() => addToCart(p)}>
                    {p.name}
                    <div className="s">
                      {p.unit || 'cái'} · còn {p.stock}
                      {useWs && p.wholesalePrice > 0 ? ` · sỉ ${fmtNum(p.wholesalePrice)}` : ''}
                      {p.stock <= 0 ? ' · HẾT' : p.stock <= settings.lowStock ? ' · sắp hết' : ''}
                    </div>
                  </button>
                  <div className="web-pc-units" data-empty={extra.length === 0 ? '' : undefined}>
                    {extra.map((u) => (
                      <button key={u.n} type="button" className="web-pc-unit" onClick={() => addToCart(p, 1, u)}>
                        <span className="web-pc-unit-n">{u.n}</span>
                        <span className="web-pc-unit-x">×{u.r}</span>
                      </button>
                    ))}
                  </div>
                  <div className="web-pc-foot"><div className="p">{fmtNum(price)}</div></div>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div className="text-center py-10 text-sm" style={{ color: 'var(--kv-subtle)' }}>Không tìm thấy sản phẩm</div>
            )}
          </div>
        </div>

        <div className={`web-pos-r ${cartOpen ? 'is-open' : ''}`}>
          <button
            type="button"
            className="web-cart-toggle"
            aria-expanded={cartOpen}
            onClick={() => setCartOpen((v) => !v)}
          >
            <span>Giỏ · {cart.length}</span>
            <span>{fmtNum(final)}</span>
          </button>
          <h3>
            Giỏ hàng
            <span style={{ fontWeight: 400, color: 'var(--kv-subtle)' }}>
              {cart.length} món · {customer ? customer.name : 'khách lẻ'}
            </span>
            {cart.length > 0 && (
              <button type="button" className="web-chip" style={{ marginLeft: 'auto' }} onClick={() => { clearCart(); setTendered(0); setCashEntered(false) }}>Xóa giỏ</button>
            )}
          </h3>
          <div className="web-pos-lines flex-1 overflow-y-auto min-h-0">
            {cart.map((ci, idx) => (
              <CartRow
                key={`${ci.productId}:${ci.unitName}:${ci.unitRatio}`}
                ci={ci}
                p={products.find((x) => x.id === ci.productId)}
                useWs={useWs}
                onQty={(d) => changeQty(idx, d)}
                onSetQty={(q) => setCart(setCartLineQty(cart, idx, q))}
                onRemove={() => setCart(removeCartLine(cart, idx))}
                onUnit={(u) => changeUnit(idx, u)}
              />
            ))}
            {cart.length === 0 && (
              <div className="px-4 py-8 text-[13px]" style={{ color: 'var(--kv-subtle)' }}>
                Chọn hàng bên trái để thêm vào giỏ.
              </div>
            )}
          </div>
          <div className="web-sum">
            <div className="web-ln"><span>Tạm tính</span><span>{fmtNum(subtotal)}</span></div>
            <div className="web-ln">
              <span>
                Giảm giá
                <button type="button" className="web-chip" style={{ marginLeft: 6 }} onClick={() => { setDiscountKind(discountKind === 'amount' ? 'percent' : 'amount'); setDiscount(0) }}>
                  {discountKind === 'percent' ? '%' : 'đ'}
                </button>
              </span>
              <input
                className="web-tender"
                type="number"
                min={0}
                value={discount || ''}
                onChange={(e) => setDiscount(Number(e.target.value) || 0)}
              />
            </div>
            {discountKind === 'percent' && discountAmt > 0 && (
              <div className="web-ln"><span>Giảm {discount}%</span><span>{fmtNum(discountAmt)}</span></div>
            )}
            <div className="web-ln big"><span>Khách trả</span><span>{fmtNum(final)}</span></div>
            <div className="web-pay">
              {methods.map((m) => (
                <button key={m.id} className={payMethod === m.id ? 'on' : ''} onClick={() => setPayMethod(m.id)}>{m.label}</button>
              ))}
            </div>
            {payMethod === 'cash' && (
              <>
                <div className="web-ln">
                  <span>Khách đưa</span>
                  <input
                    className="web-tender"
                    type="number"
                    min={0}
                    value={tendered || ''}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '') { setTendered(0); setCashEntered(false); return }
                      setTendered(Number(raw) || 0)
                      setCashEntered(true)
                    }}
                    placeholder="Nhập số" 
                  />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>
                  {DENOMINATIONS.map((d) => (
                    <button key={d} type="button" className="web-chip" onClick={() => { setTendered(d); setCashEntered(true) }}>{fmtNum(d)}</button>
                  ))}
                  <button type="button" className="web-chip ora" onClick={() => { setTendered(final); setCashEntered(true) }}>Đủ</button>
                </div>
                <div className="web-ln"><span>Tiền thối</span><span style={{ color: 'var(--ok)' }}>{fmtNum(change)}</span></div>
              </>
            )}
            {payMethod === 'transfer' && payQrSrc(settings, final, '3SU ban hang') && (
              <div className="web-pos-qr">
                <img src={payQrSrc(settings, final, '3SU ban hang')!} alt="QR chuyển khoản" />
                {settings.transferQrNote && <div className="web-pos-qr-note">{settings.transferQrNote}</div>}
                <div className="web-pos-qr-amt">Số tiền {fmt(final)}</div>
              </div>
            )}
            {isDebt && !customerId && (
              <div style={{ fontSize: 12, color: 'var(--bad)', margin: '6px 0 8px' }}>Chọn khách để ghi nợ</div>
            )}
            <button className="web-cta" style={{ minHeight: 48, fontSize: 16 }} disabled={!canConfirm || processing} onClick={handleConfirm}>
              {processing ? 'Đang chốt…' : debtAmount > 0 ? `Ghi nợ ${fmt(debtAmount)}` : 'Thanh toán'}
            </button>
          </div>
        </div>
      </div>

      {listening && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4" style={{ background: 'rgba(15,23,42,0.85)' }} onClick={handleVoice}>
          <div className="text-5xl animate-pulse">🎙️</div>
          <div className="text-base font-medium text-white">{voiceText}</div>
        </div>
      )}

      <Modal open={scanOpen} onClose={() => { scanRef.current?.cancel(); setScanOpen(false) }}>
        <div className="flex flex-col items-center gap-3">
          <div className="text-sm font-medium">Hướng camera vào mã vạch</div>
          <video ref={videoRef} className="w-full rounded-xl" style={{ maxHeight: 280, background: '#000' }} playsInline muted />
          <input
            className="web-input"
            placeholder="Gõ mã nếu camera không bắt"
            value={scanManual}
            onChange={(e) => setScanManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && scanManual.trim()) {
                addByBarcode(scanManual.trim())
                setScanManual('')
              }
            }}
          />
          <button className="web-btn" onClick={() => { scanRef.current?.cancel(); setScanOpen(false) }}>
            <X size={15} /> Đóng
          </button>
        </div>
      </Modal>

      <Sheet open={cmdOpen} onClose={() => setCmdOpen(false)} title="Lệnh nhanh">
        <textarea className="web-input min-h-[80px] resize-none" placeholder='Ví dụ: "3 mì, 1 coca"' value={cmdText} onChange={(e) => setCmdText(e.target.value)} />
        <button className="web-btn pri w-full mt-3" onClick={() => { if (cmdText.trim()) applyCommand(cmdText); setCmdText(''); setCmdOpen(false) }}>Thực hiện</button>
      </Sheet>

      <Sheet open={custOpen} onClose={() => setCustOpen(false)} title="Chọn khách">
        <button className="web-pc mb-2" onClick={() => { setCustomerId(null); setCustOpen(false) }}>
          <div className="n">Khách lẻ<div className="s">Không ghi nợ · giá theo nút sỉ/lẻ</div></div>
        </button>
        {customers.map((c) => (
          <button key={c.id} className="web-pc mb-1.5" onClick={() => { setCustomerId(c.id); setCustOpen(false) }}>
            <div className="n">
              {c.name}
              <div className="s">{c.phone || '—'}{c.wholesale ? ' · giá sỉ' : ''}{c.debt > 0 ? ` · nợ ${fmt(c.debt)}` : ''}</div>
            </div>
          </button>
        ))}
      </Sheet>

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

      <Sheet
        open={!!doneSale}
        onClose={() => setDoneSale(null)}
        title="Thanh toán thành công"
        overlayClassName="sheet-overlay--print"
        closeOnOverlay={false}
        portal
      >
        <p className="web-sub" style={{ marginBottom: 12 }}>In hóa đơn cho khách?</p>
        <div className="web-settings-actions">
          <button
            type="button"
            className="web-btn pri"
            onClick={() => {
              if (!doneSale) return
              void dispatchPrint({
                sale: doneSale.sale,
                shop,
                printer: settings.printer,
                customerName: doneSale.customerName,
                cashier: user?.name || user?.username || '',
              }).then((r) => {
                const t = printResultToast(r)
                showToast(t.text, t.kind)
              })
            }}
          >
            <Printer size={15} /> In hóa đơn
          </button>
          <button type="button" className="web-btn" onClick={() => setDoneSale(null)}>Bán tiếp</button>
          {canUseBluetoothPrint() && (
            <button
              type="button"
              className="web-btn"
              onClick={() => {
                if (!doneSale) return
                void printTicketBluetooth(saleTicketFromContext({
                  sale: doneSale.sale,
                  shop,
                  printer: settings.printer,
                  customerName: doneSale.customerName,
                  cashier: user?.name || user?.username || '',
                }), { requestIfNeeded: true }).then(
                  () => showToast('Đang in máy nhiệt…', 'ok'),
                  (e: unknown) => showToast(e instanceof Error ? e.message : 'Không in được Bluetooth', 'bad'),
                )
              }}
            >
              <Printer size={15} /> In Bluetooth K80
            </button>
          )}
          <button
            type="button"
            className="web-btn"
            onClick={() => {
              if (!doneSale) return
              const ok = printReceiptLocal({
                sale: doneSale.sale,
                shop,
                printer: settings.printer,
                customerName: doneSale.customerName,
                cashier: user?.name || user?.username || '',
              })
              if (!ok) showToast('Không in được trên máy này', 'bad')
              setDoneSale(null)
            }}
          >
            <Printer size={15} /> In trên máy này
          </button>
          <button type="button" className="web-btn" onClick={() => { setDoneSale(null); navigate('/') }}>Về trang chủ</button>
        </div>
      </Sheet>
      {leave.dialog}
    </div>
  )
}

function CartRow({
  ci, p, useWs, onQty, onSetQty, onRemove, onUnit,
}: {
  ci: CartItem
  p?: Product
  useWs: boolean
  onQty: (d: number) => void
  onSetQty: (q: number) => void
  onRemove: () => void
  onUnit: (u: { n: string; r: number }) => void
}) {
  if (!p) return null
  const unitPrice = cartUnitPrice(ci, p, useWs)
  const units = suggestUnits(p)
  return (
    <div className="web-crow">
      <div className="nm">
        {p.name}
        <br />
        <span style={{ color: 'var(--kv-subtle)', fontSize: 11 }}>
          {fmtNum(unitPrice)} / {ci.unitName}
          {units.length > 1 && (
            <>
              {' · đổi '}
              {units.filter((u) => u.n !== ci.unitName).slice(0, 1).map((u) => (
                <button key={u.n} className="underline" onClick={() => onUnit(u)}>{u.n} ×{u.r}</button>
              ))}
            </>
          )}
        </span>
      </div>
      <div className="web-qty">
        <button type="button" onClick={() => onQty(-1)}><Minus size={12} /></button>
        <input
          className="web-tender"
          style={{ width: 44, textAlign: 'center', padding: '2px 0' }}
          type="number"
          min={0}
          value={ci.qty}
          onChange={(e) => onSetQty(Number(e.target.value) || 0)}
        />
        <button type="button" onClick={() => onQty(1)}><Plus size={12} /></button>
      </div>
      <b>{fmtNum(unitPrice * ci.qty)}</b>
      <button type="button" className="web-ico" style={{ color: 'var(--kv-subtle)' }} onClick={onRemove} title="Xóa dòng"><X size={14} /></button>
    </div>
  )
}
