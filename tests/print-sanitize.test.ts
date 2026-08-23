import { describe, it, expect, vi } from 'vitest'
import { sanitizeReceiptHtml } from '@/core/browser/print'

describe('sanitizeReceiptHtml', () => {
  it('gỡ script qua DOMParser path', () => {
    // type=application/json — happy-dom không execute / fetch
    const out = sanitizeReceiptHtml(
      '<html><body><script type="application/json">{"x":1}</script><div class="rc">ok</div></body></html>',
    )
    expect(out.toLowerCase()).not.toContain('<script')
    expect(out).toContain('ok')
  })

  it('khi DOMParser lỗi → trả tài liệu rỗng an toàn (không regex fallback)', () => {
    const spy = vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(() => {
      throw new Error('boom')
    })
    try {
      const out = sanitizeReceiptHtml('<script>evil()</script><img src=x onerror=evil()>')
      expect(out).toBe('<!doctype html><html><body></body></html>')
      expect(out.toLowerCase()).not.toContain('script')
      expect(out.toLowerCase()).not.toContain('onerror')
    } finally {
      spy.mockRestore()
    }
  })
})
