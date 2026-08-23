import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

async function headersFile(): Promise<string> {
  return readFile(resolve(process.cwd(), 'public', '_headers'), 'utf8')
}

describe('Cloudflare Pages security headers', () => {
  it('chặn framing và MIME sniffing trên toàn ứng dụng', async () => {
    const text = await headersFile()
    expect(text).toContain('X-Frame-Options: DENY')
    expect(text).toContain('X-Content-Type-Options: nosniff')
    expect(text).toContain("frame-ancestors 'none'")
    expect(text).toContain("object-src 'none'")
  })

  it('bật HSTS; camera/mic self cho quét mã + giọng nói; chặn capability khác', async () => {
    const text = await headersFile()
    expect(text).toMatch(/Strict-Transport-Security: max-age=\d+/)
    expect(text).toContain('camera=(self)')
    expect(text).toContain('microphone=(self)')
    expect(text).toContain('geolocation=()')
  })

  it('CSP có default-src và script-src', async () => {
    const text = await headersFile()
    expect(text).toContain("default-src 'self'")
    expect(text).toContain("script-src 'self'")
  })

  it('không cache callback đăng nhập và trang admin', async () => {
    const text = await headersFile()
    expect(text).toMatch(/\/__\/gis[\s\S]*Cache-Control: no-store/)
    expect(text).toMatch(/\/admin\*[\s\S]*Cache-Control: no-store/)
  })
})
