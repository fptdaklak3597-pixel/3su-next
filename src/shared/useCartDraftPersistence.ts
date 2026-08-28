import { useEffect, useRef } from 'react'
import { useApp } from '@/core/store'
import { DRAFT_CART, loadFreshDraft, persistCartDraft, type CartDraft } from '@/core/domain/drafts'

export function useCartDraftPersistence() {
  const cart = useApp((s) => s.cart)
  const customerId = useApp((s) => s.customerId)
  const discount = useApp((s) => s.discount)
  const discountKind = useApp((s) => s.discountKind)
  const payMethod = useApp((s) => s.payMethod)
  const tendered = useApp((s) => s.tendered)
  const cashEntered = useApp((s) => s.cashEntered)
  const wholesaleMode = useApp((s) => s.wholesaleMode)
  const ready = useRef(false)

  useEffect(() => {
    if (!ready.current) return
    const t = window.setTimeout(() => {
      void persistCartDraft({
        items: cart,
        customerId,
        discount,
        discountKind,
        payMethod,
        tendered,
        cashEntered,
        wholesale: wholesaleMode,
      })
    }, 400)
    return () => window.clearTimeout(t)
  }, [cart, customerId, discount, discountKind, payMethod, tendered, cashEntered, wholesaleMode])

  return ready
}

export async function hydrateCartDraft(): Promise<boolean> {
  const draft = await loadFreshDraft<CartDraft>(DRAFT_CART)
  if (!draft) return false
  const s = useApp.getState()
  s.setCart(draft.items)
  s.setCustomerId(draft.customerId)
  s.setDiscount(draft.discount)
  s.setDiscountKind(draft.discountKind)
  s.setPayMethod(draft.payMethod)
  s.setTendered(draft.tendered)
  s.setCashEntered(!!draft.cashEntered)
  s.setWholesaleMode(draft.wholesale)
  return true
}
