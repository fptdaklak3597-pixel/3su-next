import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const INDEX = resolve(ROOT, 'src/index.css')
const THEME = resolve(ROOT, 'src/web/theme.css')

const ROOT_TOKENS = [
  '--fs-caption',
  '--fs-label',
  '--fs-body',
  '--fs-plus',
  '--fs-title',
  '--fs-price',
  '--fs-qr',
  '--fs-total',
  '--fs-display',
  '--hit-qty',
  '--hit-pay',
  '--hit-cta',
] as const

async function cssFiles(): Promise<{ index: string; theme: string }> {
  const [index, theme] = await Promise.all([
    readFile(INDEX, 'utf8'),
    readFile(THEME, 'utf8'),
  ])
  return { index, theme }
}

function fontSizePx(css: string): number[] {
  return [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]))
}

function ruleBlock(css: string, selector: string): string {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm')
  const m = css.match(re)
  return m?.[1] ?? ''
}

function decl(block: string, prop: string): string {
  const m = block.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`))
  return (m?.[1] ?? '').trim()
}

function pxValue(value: string): number | null {
  const m = value.match(/^([\d.]+)px$/)
  return m ? Number(m[1]) : null
}

describe('Thang chữ và vùng chạm POS', () => {
  it('khai báo đủ token trên :root (mobile)', async () => {
    const { index } = await cssFiles()
    const root = index.slice(0, index.indexOf('[data-theme="dark"]'))
    for (const token of ROOT_TOKENS) {
      expect(root, `thiếu ${token} trên :root`).toMatch(new RegExp(`${token}\\s*:`))
    }
  })

  it('khai báo đủ token trên html[data-shell="web"]', async () => {
    const { theme } = await cssFiles()
    const web = theme.slice(
      theme.indexOf('html[data-shell="web"]'),
      theme.indexOf('html[data-shell="web"][data-theme="dark"]'),
    )
    for (const token of ROOT_TOKENS) {
      expect(web, `thiếu ${token} trên web shell`).toMatch(new RegExp(`${token}\\s*:`))
    }
  })

  it('không chữ dưới 11px và không nửa pixel trong UI CSS', async () => {
    const { index, theme } = await cssFiles()
    const sizes = [...fontSizePx(index), ...fontSizePx(theme)]
    const tooSmall = [...new Set(sizes.filter((n) => n < 11))]
    const half = [...new Set(sizes.filter((n) => !Number.isInteger(n)))]
    expect(tooSmall, 'sàn HIG/M3 là 11px').toEqual([])
    expect(half, 'gộp 11.5/12.5/13.5 vào 12 hoặc 13').toEqual([])
  })

  it('POS: tổng tiền, QR, +/- và PTTT đạt chuẩn chạm', async () => {
    const { theme } = await cssFiles()

    const total = decl(ruleBlock(theme, '.web-ln.big'), 'font-size')
    expect(total === 'var(--fs-total)' || pxValue(total) === 24).toBe(true)

    const qr = decl(ruleBlock(theme, '.web-pos-qr-amt'), 'font-size')
    expect(qr === 'var(--fs-qr)' || pxValue(qr) === 20).toBe(true)

    const qty = ruleBlock(theme, '.web-qty button')
    const qtyW = decl(qty, 'width')
    const qtyH = decl(qty, 'height')
    const qtyOk = (v: string) => v === 'var(--hit-qty)' || (pxValue(v) ?? 0) >= 36
    expect(qtyOk(qtyW) && qtyOk(qtyH)).toBe(true)

    const pay = ruleBlock(theme, '.web-pay button')
    const payH = decl(pay, 'min-height') || decl(pay, 'height')
    const payFs = decl(pay, 'font-size')
    const payHOk = payH === 'var(--hit-pay)' || (pxValue(payH) ?? 0) >= 44
    const payFsOk = payFs === 'var(--fs-plus)' || (pxValue(payFs) ?? 0) >= 14
    expect(payHOk && payFsOk).toBe(true)

    const ctaH = decl(ruleBlock(theme, '.web-cta'), 'height')
    expect(ctaH === 'var(--hit-cta)' || (pxValue(ctaH) ?? 0) >= 48).toBe(true)
  })

  it('mobile: field 16px và tab không dưới 12px', async () => {
    const { index } = await cssFiles()
    const field = ruleBlock(index, '.field-input')
    const fieldFs = decl(field, 'font-size')
    const fieldOk =
      fieldFs === '16px' ||
      fieldFs === 'var(--fs-body)' ||
      index.includes('.field-input') && /font-size:\s*16px/.test(index)
    expect(fieldOk).toBe(true)

    const tabFs = decl(ruleBlock(index, '.tab-item'), 'font-size')
    expect(
      tabFs === 'var(--fs-caption)' || (pxValue(tabFs) ?? 0) >= 12,
    ).toBe(true)
  })
})
