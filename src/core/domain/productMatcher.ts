/**
 * Khớp dòng hoá đơn với SP kho — port 3su-v2.7.4 `27-product-matcher.js`.
 * Tầng: alias → trùng tên sau chuẩn hoá → fuzzy (overlap + Dice).
 * Fuzzy ≥ 0.80 chỉ gợi ý; không xác nhận thì tạo món mới khi lưu.
 * 330ml vs 390ml không tự gợi ý dù chuỗi gần nhau.
 */

export const AUTO_SUGGEST = 0.80
export const MIN_CANDIDATE = 0.35

export type MatchWhy = 'alias' | 'exact' | 'fuzzy' | 'manual' | 'none'

export type ProductAlias = {
  n: string
  sku: string
  supId: string
  pid: string
  ts: number
}

export type NamedProduct = {
  id: string
  name: string
  stock?: number
  unit?: string
  cost?: number
  barcode?: string
}

export type MatchCandidate = { p: NamedProduct; score: number }

export type ProductMatch = {
  mode: 'product' | 'new' | null
  pid?: string
  why: MatchWhy
  score: number
  cands: MatchCandidate[]
}

const NOISE = new Set([
  'chai', 'lon', 'hop', 'thung', 'goi', 'bich', 'tui', 'cay', 'vi', 'lo',
  'hu', 'chiec', 'cai', 'loc', 'combo',
])
const UNITS = new Set(['ml', 'l', 'lit', 'g', 'gr', 'gram', 'gam', 'kg'])

export function stripVN(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
}

export function normTokens(s: string): string[] {
  const raw = stripVN(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !NOISE.has(t))
  const out: string[] = []
  for (let i = 0; i < raw.length; i++) {
    if (/^\d+$/.test(raw[i]!) && i + 1 < raw.length && UNITS.has(raw[i + 1]!)) {
      out.push(raw[i]! + raw[i + 1])
      i++
    } else {
      out.push(raw[i]!)
    }
  }
  return out
}

export function normKey(s: string): string {
  return normTokens(s).join(' ')
}

export function extractSizes(s: string): string[] {
  const out: string[] = []
  const txt = stripVN(s).toLowerCase().replace(/,/g, '.')
  const re = /(\d+(?:\.\d+)?)\s*(ml|lit|l|g|gr|gram|gam|kg)(?![a-z])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(txt))) {
    let v = parseFloat(m[1]!)
    const u = m[2]!
    if (u === 'l' || u === 'lit') v *= 1000
    if (u === 'kg') v *= 1000
    const kind = (u === 'ml' || u === 'l' || u === 'lit') ? 'ml' : 'g'
    out.push(`${kind}:${Math.round(v)}`)
  }
  return out
}

function bigrams(s: string): string[] {
  const r: string[] = []
  for (let i = 0; i < s.length - 1; i++) r.push(s.slice(i, i + 2))
  return r
}

export function dice(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.length || !B.length) return 0
  const map = new Map<string, number>()
  for (const g of A) map.set(g, (map.get(g) || 0) + 1)
  let hit = 0
  for (const g of B) {
    const c = map.get(g) || 0
    if (c > 0) {
      hit++
      map.set(g, c - 1)
    }
  }
  return (2 * hit) / (A.length + B.length)
}

type Norm = { tokens: string[]; key: string; sizes: string[] }

function normOf(name: string): Norm {
  return { tokens: normTokens(name), key: normKey(name), sizes: extractSizes(name) }
}

export function score(invName: string, prodName: string): number {
  const a = normOf(String(invName))
  const b = normOf(String(prodName))
  if (!a.tokens.length || !b.tokens.length) return 0
  const sb = new Set(b.tokens)
  let inter = 0
  for (const t of new Set(a.tokens)) {
    if (sb.has(t)) inter++
  }
  const overlap = inter / Math.min(new Set(a.tokens).size, sb.size)
  const d = dice(a.tokens.join(''), b.tokens.join(''))
  let sc = 0.55 * overlap + 0.45 * d
  if (a.sizes.length && b.sizes.length) {
    const same = a.sizes.some((x) => b.sizes.includes(x))
    sc = same ? Math.min(1, sc + 0.07) : sc * 0.25
  }
  return sc
}

export function findAlias(
  aliases: ProductAlias[],
  name: string,
  sku: string,
  supId: string,
): ProductAlias | null {
  const skuN = String(sku || '').trim()
  const sid = String(supId || '')
  if (skuN) {
    const a = aliases.find((x) => x.sku && x.sku === skuN && (!x.supId || x.supId === sid))
    if (a) return a
  }
  const n = normKey(name)
  if (!n) return null
  return aliases.find((x) => x.n === n && x.supId === sid)
    || aliases.find((x) => x.n === n)
    || null
}

export function upsertAlias(
  aliases: ProductAlias[],
  name: string,
  sku: string,
  supId: string,
  pid: string,
): ProductAlias[] {
  if (!pid) return aliases
  const skuN = String(sku || '').trim()
  const sid = String(supId || '')
  const n = normKey(name)
  if (!n && !skuN) return aliases
  const list = aliases.slice()
  const i = list.findIndex((x) =>
    (skuN && x.sku === skuN && (x.supId || '') === sid)
    || (n && x.n === n && (x.supId || '') === sid),
  )
  if (i >= 0) {
    const cur = list[i]!
    list[i] = {
      ...cur,
      pid,
      sku: skuN || cur.sku,
      n: n || cur.n,
      ts: Date.now(),
    }
  } else {
    list.push({ n, sku: skuN, supId: sid, pid, ts: Date.now() })
  }
  if (list.length > 1500) return list.slice(list.length - 1500)
  return list
}

export function candidates(name: string, products: NamedProduct[], k = 6): MatchCandidate[] {
  return products
    .map((p) => ({ p, score: score(name, p.name) }))
    .filter((x) => x.score >= MIN_CANDIDATE)
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
}

export function matchLine(
  name: string,
  sku: string,
  supId: string,
  products: NamedProduct[],
  aliases: ProductAlias[],
): ProductMatch {
  const a = findAlias(aliases, name, sku, supId)
  if (a) {
    const p = products.find((x) => x.id === a.pid)
    if (p) return { mode: 'product', pid: p.id, why: 'alias', score: 1, cands: [] }
  }
  const n = normKey(name)
  if (n) {
    const p = products.find((x) => normOf(String(x.name)).key === n)
    if (p) return { mode: 'product', pid: p.id, why: 'exact', score: 1, cands: [] }
  }
  const cands = candidates(name, products, 6)
  if (cands.length && cands[0]!.score >= AUTO_SUGGEST) {
    return {
      mode: 'product',
      pid: cands[0]!.p.id,
      why: 'fuzzy',
      score: cands[0]!.score,
      cands,
    }
  }
  return { mode: null, why: 'none', score: cands[0]?.score ?? 0, cands }
}

/** Fuzzy chưa xác nhận / chọn “tạo mới” → SP mới, không học alias. */
export function resolveMatchForCommit(
  match: ProductMatch,
  confirmed: boolean,
): { productId: string; learn: boolean } {
  if (match.mode === 'new') return { productId: '', learn: false }
  if (match.why === 'fuzzy' && !confirmed) return { productId: '', learn: false }
  if (match.mode === 'product' && match.pid) {
    return { productId: match.pid, learn: true }
  }
  return { productId: '', learn: false }
}

export function manualMatch(pid: string, cands: MatchCandidate[] = []): ProductMatch {
  return { mode: 'product', pid, why: 'manual', score: 1, cands }
}

export function newProductMatch(cands: MatchCandidate[] = []): ProductMatch {
  return { mode: 'new', why: 'none', score: 0, cands }
}
