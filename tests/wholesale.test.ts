import { describe, expect, it } from 'vitest'
import {
  computeWholesalePrice,
  parseWholesaleFormula,
  roundWholesalePrice,
  applyWholesaleFormulaToProduct,
} from '@/core/domain/wholesale-formula'
import { saleUsesWholesale } from '@/core/domain/sales-core'

describe('wholesale formula', () => {
  it('percent: 10% off 22_000 → 20_000', () => {
    const cfg = parseWholesaleFormula({ mode: 'percent', value: 10 })!
    expect(computeWholesalePrice(22_000, cfg)).toBe(20_000)
  })

  it('fixed: −2_000 from 22_000 → 20_000', () => {
    const cfg = parseWholesaleFormula({ mode: 'fixed', value: 2000 })!
    expect(computeWholesalePrice(22_000, cfg)).toBe(20_000)
  })

  it('roundWholesalePrice uses step tiers', () => {
    expect(roundWholesalePrice(22_300)).toBe(23_000)
    expect(roundWholesalePrice(102_000)).toBe(105_000)
  })

  it('applyWholesaleFormulaToProduct when retail changes', () => {
    const p = { price: 10_000, wholesalePrice: 9_000 }
    const cfg = parseWholesaleFormula({ mode: 'percent', value: 10 })!
    expect(applyWholesaleFormulaToProduct(p, cfg, { oldRetail: 10_000 })).toBe(false)
    p.price = 20_000
    expect(applyWholesaleFormulaToProduct(p, cfg, { oldRetail: 10_000 })).toBe(true)
    expect(p.wholesalePrice).toBe(18_000)
  })
})

describe('saleUsesWholesale', () => {
  it('mode or customer wholesale', () => {
    expect(saleUsesWholesale(false, null)).toBe(false)
    expect(saleUsesWholesale(true, null)).toBe(true)
    expect(saleUsesWholesale(false, { wholesale: true })).toBe(true)
  })
})
