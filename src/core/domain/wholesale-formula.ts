import type { WholesaleFormula } from '../types'

export function parseWholesaleFormula(cfg: WholesaleFormula | null | undefined): WholesaleFormula | null {
  if (!cfg || !(cfg.value > 0)) return null
  return { mode: cfg.mode === 'fixed' ? 'fixed' : 'percent', value: cfg.value }
}

export function roundWholesalePrice(raw: number): number {
  const v = Math.max(0, Number(raw) || 0)
  const step = v >= 100_000 ? 5000 : v >= 20_000 ? 1000 : 500
  return Math.max(step, Math.ceil(v / step) * step)
}

export function computeWholesalePrice(retail: number, cfg: WholesaleFormula | null): number {
  const r = Math.max(0, Number(retail) || 0)
  if (!r || !cfg) return 0
  const raw = cfg.mode === 'fixed'
    ? r - Math.max(0, cfg.value)
    : r * (1 - Math.max(0, cfg.value) / 100)
  return roundWholesalePrice(raw)
}

export function wholesaleFormulaLabel(cfg: WholesaleFormula | null): string {
  if (!cfg) return ''
  return cfg.mode === 'fixed'
    ? `Giảm ${cfg.value.toLocaleString('vi-VN')}đ`
    : `Giảm ${cfg.value}%`
}

/** Cập nhật wholesalePrice trên object SP theo công thức (pure). */
export function applyWholesaleFormulaToProduct(
  p: { price: number; wholesalePrice?: number },
  cfg: WholesaleFormula | null,
  opts?: { force?: boolean; oldRetail?: number },
): boolean {
  const retail = Math.max(0, Number(p.price) || 0)
  if (!retail || !cfg) return false
  const force = !!opts?.force
  const oldRetail = opts?.oldRetail != null ? Number(opts.oldRetail) : null
  const hadWs = (Number(p.wholesalePrice) || 0) > 0
  if (!force && hadWs && (oldRetail == null || oldRetail === retail)) return false
  p.wholesalePrice = computeWholesalePrice(retail, cfg)
  return true
}
