/**
 * Câu banner/badge đọc sau sync — không sửa sổ.
 */

export function countNegativeStock(products: { deleted?: boolean; stock: number }[]): number {
  return products.filter((p) => !p.deleted && p.stock < 0).length
}

export function shopHealthBanners(opts: {
  negativeStock: number
  debtDrifts: number
  debtTo?: string
}): { text: string; to: string }[] {
  const out: { text: string; to: string }[] = []
  if (opts.negativeStock > 0) {
    out.push({ text: `${opts.negativeStock} mặt hàng tồn âm`, to: '/kho' })
  }
  if (opts.debtDrifts > 0) {
    out.push({ text: `${opts.debtDrifts} khách lệch sổ nợ`, to: opts.debtTo ?? '/doi-soat' })
  }
  return out
}

export function syncStatusBadge(opts: {
  online: boolean
  pendingOps: number
  status: string
  poisoned: number
}): { text: string; tone: 'warn' | 'bad'; to?: string } | null {
  if (opts.status === 'error' || opts.poisoned > 0) {
    return { text: 'Đồng bộ kẹt', tone: 'bad', to: '/cai-dat' }
  }
  if (opts.online && opts.pendingOps > 0) {
    return { text: `${opts.pendingOps} lệnh chờ đồng bộ`, tone: 'warn' }
  }
  return null
}

export function shopGateFromLocalId(shopId: string | null | undefined): 'in' | 'need-shop' {
  return typeof shopId === 'string' && shopId.trim() ? 'in' : 'need-shop'
}

export function shopGateFromEnterResult(opts: {
  enteredId: string | null
  localShopId: string | null
  enterFailed: boolean
}): 'in' | 'need-shop' {
  if (!opts.enterFailed) return opts.enteredId ? 'in' : 'need-shop'
  return shopGateFromLocalId(opts.localShopId)
}
