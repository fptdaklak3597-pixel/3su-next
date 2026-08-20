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

  it('bật HSTS và hạn chế browser capabilities không dùng', async () => {
    const text = await headersFile()
    expect(text).toMatch(/Strict-Transport-Security: max-age=\d+/)
    expect(text).toContain('camera=()')
    expect(text).toContain('microphone=()')
    expect(text).toContain('geolocation=()')
  })

  it('không cache callback đăng nhập và trang admin', async () => {
    const text = await headersFile()
    expect(text).toMatch(/\/__\/gis[\s\S]*Cache-Control: no-store/)
    expect(text).toMatch(/\/admin\*[\s\S]*Cache-Control: no-store/)
  })
})
