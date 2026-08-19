/**
 * HLC — Hybrid Logical Clock cho op-log.
 * Chuỗi "<ms 13 số>-<counter 4 hex>-<deviceId>" so sánh chuỗi = so sánh thời gian.
 * Chịu được đồng hồ máy sai/lùi: next() luôn tăng nghiêm ngặt.
 */
export interface HlcParts { ms: number; c: number; d: string }

export function hlcString(ms: number, c: number, d: string): string {
  return String(ms).padStart(13, '0') + '-' + c.toString(16).padStart(4, '0') + '-' + d
}

export function parseHlc(s: string): HlcParts {
  const i = s.indexOf('-')
  const j = s.indexOf('-', i + 1)
  return { ms: Number(s.slice(0, i)), c: parseInt(s.slice(i + 1, j), 16), d: s.slice(j + 1) }
}

export function compareHlc(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0
}

export interface HlcClock {
  next(): string
  observe(remote: string): void
  last(): string
}

export function createHlcClock(
  deviceId: string,
  persisted: string | null,
  persist: (s: string) => void,
  now: () => number = Date.now,
): HlcClock {
  let ms = 0
  let c = 0
  if (persisted) {
    const p = parseHlc(persisted)
    ms = p.ms
    c = p.c
  }
  function bump(t: number): void {
    if (t > ms) { ms = t; c = 0 } else { c += 1; if (c > 0xffff) { ms += 1; c = 0 } }
  }
  return {
    next() {
      bump(now())
      const s = hlcString(ms, c, deviceId)
      persist(s)
      return s
    },
    observe(remote) {
      const p = parseHlc(remote)
      if (p.ms > ms || (p.ms === ms && p.c > c)) { ms = p.ms; c = p.c }
    },
    last() { return hlcString(ms, c, deviceId) },
  }
}
