/**
 * 3SU Next — App state (Zustand)
 * State UI + session, không chứa data nghiệp vụ nặng (nằm ở IndexedDB).
 */
import { create } from 'zustand'
import type { Settings, ShopInfo, User, SyncState, TrialInfo } from '../core/types'
import { DEFAULT_SETTINGS, DEFAULT_SHOP } from '../core/db'
import type { CartItem, DiscountKind } from '../core/domain/sales'
import type { PayMethod } from '../core/types'

export interface AppState {
  /* ─── Boot ─── */
  ready: boolean
  setReady: (v: boolean) => void

  /* ─── Session / Auth ─── */
  user: User | null
  setUser: (u: User | null) => void

  shop: ShopInfo
  setShop: (s: ShopInfo) => void

  settings: Settings
  setSettings: (s: Settings) => void

  trial: TrialInfo | null
  setTrial: (t: TrialInfo | null) => void

  /* ─── Online ─── */
  online: boolean
  setOnline: (v: boolean) => void

  /* ─── Sync ─── */
  sync: SyncState
  setSync: (s: SyncState) => void

  /* ─── Cart (POS) ─── */
  cart: CartItem[]
  setCart: (c: CartItem[]) => void
  clearCart: () => void

  customerId: string | null
  setCustomerId: (id: string | null) => void

  discount: number
  setDiscount: (d: number) => void

  discountKind: DiscountKind
  setDiscountKind: (k: DiscountKind) => void

  payMethod: PayMethod
  setPayMethod: (m: PayMethod) => void

  tendered: number
  setTendered: (t: number) => void

  cashEntered: boolean
  setCashEntered: (v: boolean) => void

  wholesaleMode: boolean
  setWholesaleMode: (v: boolean) => void
  toggleWholesale: () => void

  /* ─── Toast ─── */
  toast: { msg: string; kind: 'ok' | 'bad' | 'warn' | '' } | null
  showToast: (msg: string, kind?: 'ok' | 'bad' | 'warn' | '') => void
  hideToast: () => void

  /* ─── Celebration ─── */
  celebration: { amount: number; msg: string } | null
  celebrate: (amount: number, msg: string, ms?: number) => void
  dismissCelebration: () => void

  /* ─── Theme ─── */
  theme: 'light' | 'dark' | 'system'
  setTheme: (t: 'light' | 'dark' | 'system') => void
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  setReady: (v) => set({ ready: v }),

  user: null,
  setUser: (u) => set({ user: u }),

  shop: DEFAULT_SHOP,
  setShop: (s) => set({ shop: s }),

  settings: DEFAULT_SETTINGS,
  setSettings: (s) => set({ settings: s }),

  trial: null,
  setTrial: (t) => set({ trial: t }),

  online: navigator.onLine,
  setOnline: (v) => set({ online: v }),

  sync: { status: 'idle', lastSyncAt: null, pendingOps: 0, error: null },
  setSync: (s) => set({ sync: s }),

  cart: [],
  setCart: (c) => set({ cart: c }),
  clearCart: () => {
    set({
      cart: [],
      customerId: null,
      discount: 0,
      discountKind: 'amount',
      payMethod: 'cash',
      tendered: 0,
      cashEntered: false,
    })
    void import('./domain/drafts').then((m) => m.clearDraft(m.DRAFT_CART))
  },

  customerId: null,
  setCustomerId: (id) => set({ customerId: id }),

  discount: 0,
  setDiscount: (d) => set({ discount: d }),

  discountKind: 'amount',
  setDiscountKind: (k) => set({ discountKind: k }),

  payMethod: 'cash',
  setPayMethod: (m) => set({ payMethod: m }),

  tendered: 0,
  setTendered: (t) => set({ tendered: t }),

  cashEntered: false,
  setCashEntered: (v) => set({ cashEntered: v }),

  wholesaleMode: false,
  setWholesaleMode: (v) => set({ wholesaleMode: v }),
  toggleWholesale: () => set((s) => ({ wholesaleMode: !s.wholesaleMode })),

  toast: null,
  showToast: (msg, kind = '') => {
    set({ toast: { msg, kind } })
    setTimeout(() => {
      if (get().toast?.msg === msg) set({ toast: null })
    }, 2200)
  },
  hideToast: () => set({ toast: null }),

  celebration: null,
  celebrate: (amount, msg, ms) => {
    if (!get().settings.celebrateOnSale) return
    set({ celebration: { amount, msg } })
    setTimeout(() => {
      if (get().celebration?.amount === amount) set({ celebration: null })
    }, ms ?? 2800)
  },
  dismissCelebration: () => set({ celebration: null }),

  theme: 'light',
  setTheme: (t) => {
    set({ theme: t })
    const resolved = t === 'system'
      ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : t
    document.documentElement.setAttribute('data-theme', resolved)
    const meta = document.getElementById('meta-theme-color')
    const web = document.documentElement.getAttribute('data-shell') === 'web'
    if (meta) meta.setAttribute('content', resolved === 'dark' ? (web ? '#0A0A0B' : '#151515') : (web ? '#F5F5F7' : '#FAF7F2'))
    try { localStorage.setItem('3su_theme', t) } catch { /* */ }
  },
}))
