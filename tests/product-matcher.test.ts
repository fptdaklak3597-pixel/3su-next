import { describe, expect, it } from 'vitest'
import {
  AUTO_SUGGEST,
  extractSizes,
  matchLine,
  normKey,
  resolveMatchForCommit,
  score,
  upsertAlias,
} from '@/core/domain/productMatcher'

const P = (id: string, name: string) => ({ id, name, stock: 1, unit: 'lon', cost: 10000 })

describe('productMatcher (port v2.7.4)', () => {
  it('normalizes 390 ml and packaging noise', () => {
    expect(normKey('Sting đỏ chai 390 ml')).toBe('sting do 390ml')
  })

  it('extracts comparable sizes', () => {
    expect(extractSizes('Pepsi 330ml')).toEqual(['ml:330'])
    expect(extractSizes('Pepsi 0.33 L')).toEqual(['ml:330'])
  })

  it('exact match after normalize', () => {
    const m = matchLine('Cà phê sữa', '', '', [P('p1', 'Ca phe sua')], [])
    expect(m.why).toBe('exact')
    expect(m.pid).toBe('p1')
  })

  it('does not auto-suggest 330ml onto 390ml', () => {
    const sc = score('Sting đỏ 330ml', 'Sting đỏ 390ml')
    expect(sc).toBeLessThan(AUTO_SUGGEST)
    const m = matchLine('Sting đỏ 330ml', '', '', [P('p1', 'Sting đỏ 390ml')], [])
    expect(m.why).toBe('none')
  })

  it('fuzzy-suggests high-overlap names that are not exact', () => {
    const m = matchLine('Pepsi Cola 330ml', '', '', [P('p1', 'Pepsi 330ml')], [])
    expect(m.why).toBe('fuzzy')
    expect(m.pid).toBe('p1')
    expect(m.score).toBeGreaterThanOrEqual(AUTO_SUGGEST)
  })

  it('lists candidates below auto-suggest', () => {
    const m = matchLine('cafe sua', '', '', [P('p1', 'Cà phê sữa đá')], [])
    expect(m.why).toBe('none')
    expect(m.cands.length).toBeGreaterThan(0)
  })

  it('uses learned alias before fuzzy', () => {
    const aliases = upsertAlias([], 'SP NCC ABC', 'SKU1', 'sup1', 'p9')
    const m = matchLine('SP NCC ABC', 'SKU1', 'sup1', [P('p9', 'Tên khác trong kho')], aliases)
    expect(m.why).toBe('alias')
    expect(m.pid).toBe('p9')
  })

  it('unconfirmed fuzzy becomes a new product on commit', () => {
    const fuzzy = {
      mode: 'product' as const,
      pid: 'p1',
      why: 'fuzzy' as const,
      score: 0.85,
      cands: [],
    }
    expect(resolveMatchForCommit(fuzzy, false)).toEqual({ productId: '', learn: false })
    expect(resolveMatchForCommit(fuzzy, true)).toEqual({ productId: 'p1', learn: true })
  })

  it('explicit new / manual pick follow old commit rules', () => {
    expect(resolveMatchForCommit({ mode: 'new', why: 'none', score: 0, cands: [] }, true))
      .toEqual({ productId: '', learn: false })
    expect(resolveMatchForCommit({ mode: 'product', pid: 'p2', why: 'manual', score: 1, cands: [] }, false))
      .toEqual({ productId: 'p2', learn: true })
  })
})
