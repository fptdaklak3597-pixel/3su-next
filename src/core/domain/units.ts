/**
 * 3SU Next — Công cụ đơn vị (Unit tools)
 * Port nghiệp vụ từ 30-tools-units.js + UNIT_PACKS trong 10-core.js.
 * Gợi ý bộ đơn vị theo tên sản phẩm + quy đổi giá theo hệ số.
 */
import type { ProductUnit } from '../types'

/** Bộ đơn vị gợi ý theo tên/danh mục sản phẩm (giống UNIT_PACKS bản gốc). */
export const UNIT_PACKS: { m: RegExp; u: ProductUnit[] }[] = [
  { m: /mì|phở|bún|cháo|miến/i, u: [{ n: 'gói', r: 1 }, { n: 'thùng', r: 30 }] },
  { m: /coca|pepsi|sting|revive|7up|trà xanh|c2|nước ngọt/i, u: [{ n: 'chai', r: 1 }, { n: 'lốc', r: 6 }, { n: 'thùng', r: 24 }] },
  { m: /la vie|aquafina|vĩnh hảo|dasani|nước suối/i, u: [{ n: 'chai', r: 1 }, { n: 'thùng', r: 24 }] },
  { m: /bia|heineken|tiger|sài gòn|333|saigon/i, u: [{ n: 'lon', r: 1 }, { n: 'lốc', r: 6 }, { n: 'thùng', r: 24 }] },
  { m: /sữa|vinamilk|yomost|milo|th true/i, u: [{ n: 'hộp', r: 1 }, { n: 'lốc', r: 4 }, { n: 'thùng', r: 48 }] },
  { m: /bánh|snack|oishi|poca|lay'?s|cosy|chocopie/i, u: [{ n: 'gói', r: 1 }, { n: 'thùng', r: 20 }] },
  { m: /kẹo|socola/i, u: [{ n: 'gói', r: 1 }, { n: 'hộp', r: 12 }] },
  { m: /thuốc lá|vinataba|marlboro/i, u: [{ n: 'gói', r: 1 }, { n: 'cây', r: 10 }] },
  { m: /gạo/i, u: [{ n: 'kg', r: 1 }, { n: 'bao 5kg', r: 5 }, { n: 'bao 10kg', r: 10 }] },
  { m: /dầu ăn|tường an|neptune|simply/i, u: [{ n: 'chai', r: 1 }, { n: 'thùng', r: 12 }] },
  { m: /nước mắm|nam ngư|chinsu|tương/i, u: [{ n: 'chai', r: 1 }, { n: 'thùng', r: 12 }] },
  { m: /trứng/i, u: [{ n: 'quả', r: 1 }, { n: 'chục', r: 10 }, { n: 'vỉ', r: 30 }] },
]

/** Gợi ý bộ đơn vị: ưu tiên units tự định nghĩa, sau đó theo tên, cuối cùng đơn vị gốc. */
export function unitsFor(p: { name?: string; cat?: string; unit?: string; units?: ProductUnit[] }): ProductUnit[] {
  const base: ProductUnit = { n: p.unit || 'cái', r: 1 }
  if (p.units && p.units.length) return [base, ...p.units]
  const hay = (p.name || '') + ' ' + (p.cat || '')
  for (const pack of UNIT_PACKS) if (pack.m.test(hay)) return pack.u
  return [base]
}

/**
 * Quy đổi giá theo đơn vị: giá đơn vị lớn = giá gốc × hệ số.
 * VD: giá 1 chai = 10.000đ, thùng (r=24) → 240.000đ.
 */
export function convertPriceByUnit(basePrice: number, unit: ProductUnit): number {
  return Math.round(basePrice * (unit.r || 1))
}

/**
 * Phân rã một số lượng theo các đơn vị (từ lớn đến nhỏ).
 * VD: 50 chai với [thùng=24, chai=1] → { thùng: 2, chai: 2 }.
 */
export function breakdownQty(qty: number, units: ProductUnit[]): Record<string, number> {
  const sorted = [...units].sort((a, b) => b.r - a.r)
  let remain = Math.max(0, Math.floor(qty))
  const out: Record<string, number> = {}
  for (const u of sorted) {
    const r = Math.max(1, Math.floor(u.r))
    const count = Math.floor(remain / r)
    if (count > 0) out[u.n] = count
    remain -= count * r
  }
  return out
}
