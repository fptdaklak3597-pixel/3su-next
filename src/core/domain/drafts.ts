/**
 * Draft local (giỏ / phiếu nhập / kiểm kê). Chỉ meta, không enqueueOp.
 */
import { getMeta, setMeta } from '../db'
import type { PayMethod } from '../types'
import type { CartItem, DiscountKind } from './sales'

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
export const DRAFT_CART = 'draft:cart'
export const DRAFT_RECEIPT = 'draft:receipt'
export const DRAFT_STOCKTAKE = 'draft:stocktake'
export const DRAFT_INVOICE = 'draft:invoice'
export const DRAFT_PRODUCT = 'draft:product'
export const DRAFT_PO = 'draft:po'

export interface CartDraft {
  items: CartItem[]
  customerId: string | null
  discount: number
  discountKind: DiscountKind
  payMethod: PayMethod
  tendered: number
  cashEntered: boolean
  wholesale: boolean
  updatedAt: number
}

export interface ReceiptDraft {
  supplierId: string
  supplierName: string
  date: string
  expiry: string
  note: string
  rows: unknown[]
  paid: number
  payMethod: 'cash' | 'transfer' | 'debt'
  updatedAt: number
}

export interface StocktakeDraft {
  actual: Record<string, number>
  touched: Record<string, true>
  note: string
  updatedAt: number
}

export interface InvoiceDraft {
  inv: unknown
  rows: unknown[]
  supName: string
  supId: string
  date: string
  expiry: string
  paid: number
  payMethod: 'cash' | 'transfer' | 'debt'
  updatedAt: number
}

export interface ProductDraft {
  isNew: boolean
  productId: string
  form: Record<string, unknown>
  updatedAt: number
}

export interface PoDraft {
  supplierId: string
  supplierName: string
  rows: unknown[]
  note: string
  updatedAt: number
}

export function isDraftFresh(updatedAt: number, now = Date.now()): boolean {
  return Number.isFinite(updatedAt) && now - updatedAt >= 0 && now - updatedAt < DRAFT_TTL_MS
}

export function cartDraftIsEmpty(d: Pick<CartDraft, 'items' | 'customerId' | 'discount'>): boolean {
  return d.items.length === 0 && !d.customerId && !d.discount
}

export async function loadFreshDraft<T extends { updatedAt: number }>(key: string): Promise<T | null> {
  const raw = await getMeta<T | null>(key, null)
  if (!raw || typeof raw !== 'object' || !isDraftFresh(raw.updatedAt)) {
    if (raw) await setMeta(key, null)
    return null
  }
  return raw
}

export async function persistCartDraft(input: Omit<CartDraft, 'updatedAt'>): Promise<void> {
  if (cartDraftIsEmpty(input)) {
    await setMeta(DRAFT_CART, null)
    return
  }
  await setMeta(DRAFT_CART, { ...input, updatedAt: Date.now() })
}

export async function persistReceiptDraft(input: Omit<ReceiptDraft, 'updatedAt'>): Promise<void> {
  if (input.rows.length === 0 && !input.note.trim() && !input.supplierName.trim()) {
    await setMeta(DRAFT_RECEIPT, null)
    return
  }
  await setMeta(DRAFT_RECEIPT, { ...input, updatedAt: Date.now() })
}

export async function persistInvoiceDraft(input: Omit<InvoiceDraft, 'updatedAt'>): Promise<void> {
  if (!input.inv && (!input.rows || input.rows.length === 0)) {
    await setMeta(DRAFT_INVOICE, null)
    return
  }
  await setMeta(DRAFT_INVOICE, { ...input, updatedAt: Date.now() })
}

export async function persistProductDraft(input: Omit<ProductDraft, 'updatedAt'>): Promise<void> {
  await setMeta(DRAFT_PRODUCT, { ...input, updatedAt: Date.now() })
}

export async function persistPoDraft(input: Omit<PoDraft, 'updatedAt'>): Promise<void> {
  if ((!input.rows || input.rows.length === 0) && !input.note.trim() && !input.supplierId && !input.supplierName.trim()) {
    await setMeta(DRAFT_PO, null)
    return
  }
  await setMeta(DRAFT_PO, { ...input, updatedAt: Date.now() })
}

export async function persistStocktakeDraft(input: Omit<StocktakeDraft, 'updatedAt'>): Promise<void> {
  if (Object.keys(input.touched).length === 0 && !input.note.trim()) {
    await setMeta(DRAFT_STOCKTAKE, null)
    return
  }
  await setMeta(DRAFT_STOCKTAKE, { ...input, updatedAt: Date.now() })
}

export async function clearDraft(key: string): Promise<void> {
  await setMeta(key, null)
}
