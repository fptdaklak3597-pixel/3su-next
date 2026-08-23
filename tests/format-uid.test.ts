import { describe, it, expect } from 'vitest'
import { escapeHtml, uid } from '@/core/format'

describe('uid + escapeHtml', () => {
  it('uid dùng crypto.randomUUID khi có sẵn', () => {
    const a = uid('s')
    const b = uid('s')
    expect(a).toMatch(/^s_/)
    expect(b).toMatch(/^s_/)
    expect(a).not.toBe(b)
    // UUID v4 dạng 8-4-4-4-12
    expect(a.slice(2)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it("escapeHtml escape cả dấu nháy đơn '", () => {
    expect(escapeHtml(`a'b"c`)).toBe('a&#39;b&quot;c')
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
  })
})
