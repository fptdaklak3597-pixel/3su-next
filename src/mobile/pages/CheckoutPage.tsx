/**
 * 3SU Next — Thanh toán (Checkout)
 * Port từ 14b-checkout.js: payment methods, tendered/change, denominations,
 * discount, transfer QR, debt, celebration.
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { confirmCheckoutSale, maybeQueueEinvoiceForSale, cartUnitPrice, checkoutFingerprint, customerHabits, DENOMINATIONS, discountToAmount, effectiveCashTendered, saleUsesWholesale } from '@/core/domain/sales'
import { playPosSound } from '@/core/browser/posSound'
import { printReceiptLocal } from '@/core/browser/print'
import { dispatchPrint, printResultToast } from '@/core/browser/printQueue'
import { canUseBluetoothPrint, printTicketBluetooth } from '@/core/browser/printBluetooth'
import { saleTicketFromContext } from '@/core/browser/printTicket'
import { fmt, fmtShort } from '@/core/format'
import { logError } from '@/core/errorLogger'
import { createConfirmGate } from '@/core/confirmGate'
import { ChevronLeft, User, Printer } from 'lucide-react'
import { payQrSrc } from '@/core/domain/vietqr'
import type { PayMethod, Product, Sale } from '@/core/types'

export function CheckoutPage() {
  const navigate = useNavigate()
  const cart = useApp((s) => s.cart)
  const clearCart = useApp((s) => s.clearCart)
  const wholesaleMode = useApp((s) => s.wholesaleMode)
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

  const [processing, setProcessing] = useState(false)
  const [showCustomerPick, setShowCustomerPick] = useState(false)
  const [doneSale, setDoneSale] = useState<{ sale: Sale; customerName: string | null } | null>(null)
  const confirmGate = useRef(createConfirmGate())
  const idempKeyRef = useRef<string | null>(null)

  const products = useLiveQuery(() => dbx.products.toArray(), [], [] as Product[])
  const sales = useLiveQuery(
    () => customerId
      ? dbx.sales.where('customerId').equals(customerId).toArray()
      : Promise.resolve([] as Sale[]),
    [customerId],
    [] as Sale[],
  )
  const customers = useLiveQuery(
    () => dbx.customers.filter((c) => !c.deleted).toArray(),
    [],
    [],
  )

  const customer = customerId ? customers.find((c) => c.id === customerId) : null
  const useWs = saleUsesWholesale(wholesaleMode, customer)

  const subtotal = useMemo(() => {
    return cart.reduce((sum, ci) => {
      const p = products.find((x) => x.id === ci.productId)
      if (!p) return sum
      return sum + cartUnitPrice(ci, p, useWs) * ci.qty
    }, 0)
  }, [cart, products, useWs])

  const discountAmt = discountToAmount(subtotal, discount, discountKind)
  const final = Math.max(0, subtotal - discountAmt)
  const profit = useMemo(() => {
    return cart.reduce((sum, ci) => {
      const p = products.find((x) => x.id === ci.productId)
      if (!p) return sum
      return sum + (cartUnitPrice(ci, p, useWs) - p.cost * ci.unitRatio) * ci.qty
    }, 0) - discountAmt
  }, [cart, products, useWs, discountAmt])
  const isDebt = payMethod === 'debt'
  const cash = effectiveCashTendered({ payMethod, total: final, tendered, cashEntered })
  const effectiveTendered = cash.tendered
  const change = cash.change
  const debtAmount = cash.debtAmount
  const underpaid = !isDebt && payMethod === 'cash' && cashEntered && effectiveTendered < final
  const canConfirm = cart.length > 0
    && !cash.needsCashEntry
    && (debtAmount === 0 || !!customerId)

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
      celebrate(sale.total, `Hay lắm${shop.name ? ' ' + shop.name.split(' ').slice(-1)[0] : ''}!`)

      showToast(
        '✓ Đã chốt đơn ' + fmt(sale.total) + (warnings[0] ? ' · ' + warnings[0] : ''),
        warnings.length ? 'warn' : 'ok',
      )

      const customerName = customer?.name ?? null
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
      logError(e, 'checkout.confirm')
      showToast(e instanceof Error ? e.message : 'Lỗi khi chốt đơn', 'bad')
    } finally {
      setProcessing(false)
      confirmGate.current.leave()
    }
  }

  function printCtx() {
    return {
      sale: doneSale!.sale,
      shop,
      printer: settings.printer,
      customerName: doneSale!.customerName,
      cashier: user?.name || user?.username || '',
    }
  }

  async function handleSendPrint() {
    if (!doneSale) return
    const r = await dispatchPrint(printCtx())
    const t = printResultToast(r)
    showToast(t.text, t.kind)
  }

  function handlePrintDone() {
    if (!doneSale) return
    const ok = printReceiptLocal(printCtx())
    if (!ok) showToast('Không in được trên thiết bị này', 'bad')
  }

  async function handleBluetoothPrint() {
    if (!doneSale) return
    try {
      await printTicketBluetooth(saleTicketFromContext(printCtx()), { requestIfNeeded: true })
      showToast('Đang in máy nhiệt…', 'ok')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Không in được Bluetooth', 'bad')
    }
  }

  function keepSearch(pathname: string) {
    navigate({ pathname, search: window.location.search })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => keepSearch('/ban-hang')}>
          <ChevronLeft size={20} />
        </button>
        <div className="text-center flex-1">
          <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Thanh toán</div>
          <div className="text-xs font-medium tracking-wider uppercase" style={{ color: 'var(--mute)' }}>
            {cart.reduce((a, c) => a + c.qty, 0)} món · lời {fmt(profit)}
          </div>
        </div>
        <div className="w-9" />
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 max-w-[480px] mx-auto w-full">
        {/* Amount hero */}
        <div className="text-center mb-6">
          <div className="text-xs font-medium tracking-widest uppercase mb-1" style={{ color: 'var(--mute)' }}>Khách trả</div>
          <div className="font-brand italic stat-num text-4xl" style={{ color: 'var(--ink)' }}>{fmt(final)}</div>
          {discount > 0 && (
            <div className="text-xs mt-1" style={{ color: 'var(--mute)' }}>Giảm {fmt(discount)}</div>
          )}
          {profit < 0 && (
            <div className="text-xs mt-1 font-medium" style={{ color: 'var(--down)' }}>
              ⚠ Đang lỗ {fmt(-profit)}
            </div>
          )}
        </div>

        {/* Payment method */}
        <div className="flex gap-2 mb-5">
          {([['cash', '💵', 'Tiền mặt'], ['transfer', '📱', 'Chuyển khoản'], ['debt', '📝', 'Ghi nợ']] as [PayMethod, string, string][]).map(([method, icon, label]) => (
            <button
              key={method}
              className={`flex-1 py-3.5 rounded-xl border text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                payMethod === method
                  ? 'border-ink bg-ink text-paper'
                  : 'border-hair bg-paper-2'
              }`}
              style={payMethod !== method ? { color: 'var(--ink-2)', borderColor: 'var(--hair)' } : undefined}
              onClick={() => setPayMethod(method)}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Cash: tendered + denominations */}
        {payMethod === 'cash' && (
          <div className="card p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm" style={{ color: 'var(--mute)' }}>Khách đưa</span>
              <input
                className="field-input !w-36 text-right text-lg font-medium stat-num"
                type="number"
                inputMode="numeric"
                value={tendered || ''}
                placeholder="Nhập số"
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === '') { setTendered(0); setCashEntered(false); return }
                  setTendered(Number(raw) || 0)
                  setCashEntered(true)
                }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {DENOMINATIONS.map((d) => (
                <button key={d} className="chip" onClick={() => { setTendered(d); setCashEntered(true) }}>
                  {fmtShort(d)}
                </button>
              ))}
              <button className="chip !bg-gold !text-white !border-gold" onClick={() => { setTendered(final); setCashEntered(true) }}>
                Đủ
              </button>
            </div>
            {/* Change / debt */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t" style={{ borderColor: 'var(--hair)' }}>
              <span className="text-sm" style={{ color: 'var(--mute)' }}>
                {underpaid ? 'Ghi nợ' : 'Tiền thối'}
              </span>
              <span className={`text-lg font-medium stat-num ${underpaid ? 'text-down' : change > 0 ? 'text-up' : ''}`}
                style={!underpaid && change === 0 ? { color: 'var(--ink)' } : undefined}>
                {underpaid ? fmt(final - effectiveTendered) : fmt(change)}
              </span>
            </div>
            {cash.needsCashEntry && (
              <div className="text-xs mt-1" style={{ color: 'var(--mute)' }}>
                Nhập số khách đưa hoặc bấm Đủ. Để trống không tính là đã trả.
              </div>
            )}
            {underpaid && (
              <div className="text-xs mt-1" style={{ color: 'var(--mute)' }}>
                Nhập nhỏ hơn tổng để ghi nợ phần còn lại
              </div>
            )}
          </div>
        )}

        {/* Transfer QR — VietQR động theo số tiền, fallback ảnh tĩnh */}
        {payMethod === 'transfer' && payQrSrc(settings, final, '3SU ban hang') && (
          <div className="card p-4 mb-4 text-center">
            <div className="text-xs font-medium mb-2" style={{ color: 'var(--mute)' }}>Quét mã chuyển khoản</div>
            <img src={payQrSrc(settings, final, '3SU ban hang')!} alt="QR chuyển khoản" className="mx-auto max-w-[180px] rounded-lg" />
            {settings.transferQrNote && (
              <div className="text-xs mt-2" style={{ color: 'var(--mute)' }}>{settings.transferQrNote}</div>
            )}
            <div className="text-sm mt-2 font-medium">Số tiền: <b>{fmt(final)}</b></div>
          </div>
        )}

        {/* Discount */}
        {isDebt && !customerId && (
          <div className="text-xs mb-3" style={{ color: 'var(--down)' }}>Chọn khách để ghi nợ</div>
        )}

        <div className="flex items-center justify-between mb-4">
          <span className="text-sm" style={{ color: 'var(--mute)' }}>
            Giảm giá
            <button type="button" className="chip ml-2" onClick={() => { setDiscountKind(discountKind === 'amount' ? 'percent' : 'amount'); setDiscount(0) }}>
              {discountKind === 'percent' ? '%' : 'đ'}
            </button>
          </span>
          <input
            className="field-input !w-32 text-right"
            type="number"
            inputMode="numeric"
            value={discount || ''}
            placeholder="0"
            onChange={(e) => setDiscount(Number(e.target.value) || 0)}
          />
        </div>
        {discountKind === 'percent' && discountAmt > 0 && (
          <div className="text-xs mb-3 text-right" style={{ color: 'var(--mute)' }}>Giảm {fmt(discountAmt)}</div>
        )}

        {customerId && (
          <div className="flex flex-wrap gap-2 mb-3">
            {customerHabits(sales, customerId).slice(0, 3).map((h) => {
              const p = products.find((x) => x.id === h.productId)
              if (!p) return null
              return (
                <span key={h.productId} className="chip">Hay mua: {p.name}</span>
              )
            })}
          </div>
        )}

        {/* Customer */}
        <button
          className="list-row mb-4"
          onClick={() => setShowCustomerPick(true)}
        >
          <User size={18} style={{ color: 'var(--mute)' }} />
          <div className="flex-1 text-left">
            <span className="text-sm" style={{ color: customer ? 'var(--ink)' : 'var(--mute)' }}>
              {customer ? customer.name : 'Chọn khách hàng (tùy chọn)'}
            </span>
            {customer && customer.debt > 0 && (
              <span className="text-xs ml-2" style={{ color: 'var(--down)' }}>đang nợ {fmt(customer.debt)}</span>
            )}
          </div>
        </button>
      </div>

      {/* Confirm button */}
      <div className="px-5 pb-5 pt-2" style={{ background: 'var(--paper)' }}>
        <button className="btn-cta" disabled={!canConfirm || processing} onClick={handleConfirm}>
          {processing ? 'Đang xử lý…' : debtAmount > 0 ? `Ghi nợ · ${fmt(debtAmount)}` : `Xác nhận · ${fmt(final)}`}
        </button>
      </div>

      {/* Customer picker sheet */}
      {showCustomerPick && (
        <div className="sheet-overlay" onClick={() => setShowCustomerPick(false)}>
          <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grab" />
            <h3 className="font-brand text-base font-medium mb-3">Chọn khách hàng</h3>
            <button className="list-row mb-2" onClick={() => { setCustomerId(null); setShowCustomerPick(false) }}>
              <span className="text-sm" style={{ color: 'var(--mute)' }}>Không chọn</span>
            </button>
            {customers.map((c) => (
              <button key={c.id} className="list-row mb-1.5" onClick={() => { setCustomerId(c.id); setShowCustomerPick(false) }}>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{c.name}</div>
                  <div className="text-xs" style={{ color: 'var(--mute)' }}>
                    {c.phone || '—'}{c.debt > 0 ? ` · nợ ${fmt(c.debt)}` : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Tờ in gắn body: “Hay lắm” (z 200, ngoài main) không đè được. Không đóng khi chạm nền. */}
      {doneSale && createPortal(
        <div className="sheet-overlay sheet-overlay--print">
          <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grab" />
            <h3 className="font-brand text-base font-medium text-center mb-1">Thanh toán thành công</h3>
            <p className="text-center text-sm mb-4" style={{ color: 'var(--mute)' }}>In hóa đơn cho khách?</p>
            <div className="flex flex-col gap-2">
              <button className="btn-cta flex items-center justify-center gap-2" onClick={() => void handleSendPrint()}>
                <Printer size={18} /> In hóa đơn
              </button>
              <button className="btn-ghost" onClick={() => { setDoneSale(null); keepSearch('/ban-hang') }}>
                Bán tiếp
              </button>
              {canUseBluetoothPrint() && (
                <button className="btn-ghost flex items-center justify-center gap-2" onClick={() => void handleBluetoothPrint()}>
                  <Printer size={18} /> In Bluetooth K80
                </button>
              )}
              <button className="btn-ghost flex items-center justify-center gap-2" onClick={handlePrintDone}>
                <Printer size={18} /> In trên máy này
              </button>
              <button className="btn-ghost" onClick={() => { setDoneSale(null); keepSearch('/') }}>
                Về trang chủ
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
