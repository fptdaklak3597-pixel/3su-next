/**
 * 3SU Next — Quy tắc giá (Pricing rules)
 * Port nghiệp vụ từ 18a-pricing.js.
 * Tự động gợi ý giá bán theo biên lợi nhuận mục tiêu, làm tròn bước giá.
 */
import { dbx } from '../db'
import { uid } from '../format'
import type { PricingRule, Product } from '../types'
import { makeOp, persistOp, requestFlush } from '../sync/engine'

/** Giá = vốn × (1 + margin%) rồi làm tròn đến bước giá (roundTo). */
export function applyPricingRule(cost: number, rule: PricingRule): number {
  if (cost <= 0) return 0
  const raw = cost * (1 + rule.marginPct / 100)
  const step = rule.roundTo > 0 ? rule.roundTo : 100
  return Math.round(raw / step) * step
}

/** Tìm quy tắc khớp nhất: ưu tiên đúng danh mục, sau đó quy tắc tổng ('' = tất cả). */
export function matchPricingRule(cat: string, rules: PricingRule[]): PricingRule | null {
  const active = rules.filter((r) => r.active)
  const byCat = active.find((r) => r.cat && r.cat === cat)
  if (byCat) return byCat
  return active.find((r) => !r.cat) ?? null
}

/** Gợi ý giá bán cho sản phẩm theo bộ quy tắc; null nếu không có quy tắc nào khớp. */
export function suggestPriceByRules(p: Pick<Product, 'cat' | 'cost'>, rules: PricingRule[]): number | null {
  const rule = matchPricingRule(p.cat, rules)
  if (!rule) return null
  const price = applyPricingRule(p.cost, rule)
  return price > 0 ? price : null
}

/* ─── CRUD quy tắc ─── */
export interface PricingRuleInput {
  name: string
  cat?: string
  marginPct: number
  roundTo?: number
}

export async function createPricingRule(input: PricingRuleInput): Promise<PricingRule> {
  const name = input.name.trim()
  if (!name) throw new Error('Cần tên quy tắc')
  const rule: PricingRule = {
    id: uid('pr'),
    name,
    cat: (input.cat ?? '').trim(),
    marginPct: Math.max(0, Math.min(500, input.marginPct)),
    roundTo: input.roundTo && input.roundTo > 0 ? input.roundTo : 100,
    active: true,
  }
  await dbx.transaction('rw', [dbx.pricingRules, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('pricing.upsert', null)
    rule.hlc = op.hlc
    await dbx.pricingRules.put(rule)
    op.payload = rule
    await persistOp(op)
  })
  requestFlush()
  return rule
}

export async function togglePricingRule(id: string): Promise<void> {
  await dbx.transaction('rw', [dbx.pricingRules, dbx.syncQueue, dbx.appliedOps], async () => {
    const r = await dbx.pricingRules.get(id)
    if (!r) return
    const op = makeOp('pricing.upsert', null)
    r.active = !r.active
    r.hlc = op.hlc
    await dbx.pricingRules.put(r)
    op.payload = r
    await persistOp(op)
  })
  requestFlush()
}

export async function deletePricingRule(id: string): Promise<void> {
  const r = await dbx.pricingRules.get(id)
  if (!r) return
  await dbx.transaction('rw', [dbx.pricingRules, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('pricing.delete', { ruleId: id })
    await dbx.pricingRules.put({ ...r, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
    await persistOp(op)
  })
  requestFlush()
}
