/**
 * Genesis opening + legacy money-path guard (Phase 11–12).
 */
import type { ShopState } from './processor'
import { emptyShopState, cloneState } from './processor'

export interface GenesisSnapshot {
  shopId: string
  products: ShopState['products']
  customers: ShopState['customers']
  suppliers: ShopState['suppliers']
  fingerprint: string
}

export function fingerprintSnapshot(s: Omit<GenesisSnapshot, 'fingerprint'>): string {
  return JSON.stringify({
    p: Object.keys(s.products).sort().map((id) => [id, s.products[id].stock, s.products[id].cost]),
    c: Object.keys(s.customers).sort().map((id) => [id, s.customers[id].balance]),
    s: Object.keys(s.suppliers).sort().map((id) => [id, s.suppliers[id].balance]),
  })
}

export function applyGenesis(state: ShopState, snap: GenesisSnapshot, existing?: GenesisSnapshot): ShopState {
  if (existing) {
    if (existing.fingerprint !== snap.fingerprint) {
      throw new Error('GENESIS_MISMATCH')
    }
    return state // idempotent
  }
  if (state.seq > 0 || Object.keys(state.sales).length > 0) {
    throw new Error('GENESIS_ALREADY_ACTIVE')
  }
  const next = cloneState(emptyShopState(snap.shopId))
  next.products = structuredClone(snap.products)
  next.customers = structuredClone(snap.customers)
  next.suppliers = structuredClone(snap.suppliers)
  return next
}

/** Legacy money ops forbidden when authoritative flag on */
export const LEGACY_MONEY_OP_TYPES = new Set([
  'sale.commit',
  'sale.void',
  'gr.commit',
  'debt.pay',
  'supplier.pay',
])

export function assertNoLegacyMoneyOp(type: string, authoritativeOn: boolean): void {
  if (authoritativeOn && LEGACY_MONEY_OP_TYPES.has(type)) {
    throw new Error(`Legacy money op bị cấm khi authoritative bật: ${type}`)
  }
}
