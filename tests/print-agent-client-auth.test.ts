import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dbx, exportBackup } from '@/core/db'
import {
  PRINT_AUTH_HEADERS,
  generateLanPrintSecret,
  getLanPrintSecret,
  isLoopbackLanAgentUrl,
  lanAgentNeedsSecret,
  normalizeLanAgentUrl,
  setLanPrintSecret,
  signedLanPrintHeaders,
} from '@/core/browser/printAgentAuth'
import { tryLanPrint } from '@/core/browser/printQueue'
import { testTicket } from '@/core/browser/printTicket'
import { verifyPrintSignature } from '../scripts/print-agent-core.mjs'

beforeEach(async () => {
  vi.unstubAllGlobals()
  await dbx.meta.clear()
})

describe('device-local print secret', () => {
  it('lưu, đọc và xóa secret trong meta cục bộ', async () => {
    const secret = generateLanPrintSecret()
    expect(secret.length).toBeGreaterThanOrEqual(32)
    await setLanPrintSecret(secret)
    expect(await getLanPrintSecret()).toBe(secret)
    await setLanPrintSecret('')
    expect(await getLanPrintSecret()).toBe('')
  })

  it('secret không xuất hiện trong backup JSON', async () => {
    const secret = '0123456789abcdef0123456789abcdef'
    await setLanPrintSecret(secret)
    const data = await exportBackup()
    expect(JSON.stringify(data)).not.toContain(secret)
    expect(JSON.stringify(data)).not.toContain('print:lanSecret')
  })
})

describe('agent URL policy', () => {
  it('chuẩn hóa URL và phân biệt loopback/LAN', () => {
    expect(normalizeLanAgentUrl(' http://127.0.0.1:9101/ ')).toBe('http://127.0.0.1:9101')
    expect(isLoopbackLanAgentUrl('http://localhost:9101')).toBe(true)
    expect(lanAgentNeedsSecret('http://192.168.1.20:9101')).toBe(true)
  })

  it('từ chối protocol và URL có credential/query', () => {
    expect(() => normalizeLanAgentUrl('file:///tmp/agent')).toThrow(/http\/https/)
    expect(() => normalizeLanAgentUrl('http://user:pass@host:9101')).toThrow(/tài khoản/)
    expect(() => normalizeLanAgentUrl('http://host:9101?token=x')).toThrow(/query/)
  })
})

describe('browser/server HMAC interoperability', () => {
  it('browser tạo signature được server verifier chấp nhận', async () => {
    const secret = '0123456789abcdef0123456789abcdef'
    const body = JSON.stringify({ ticket: testTicket('Shop', 58) })
    const now = 1_787_184_000_000
    const nonce = 'nonce_abcdefghijklmnop'
    const headers = await signedLanPrintHeaders(secret, body, { now, nonce })

    expect(verifyPrintSignature({
      secret,
      timestamp: headers[PRINT_AUTH_HEADERS.timestamp]!,
      nonce: headers[PRINT_AUTH_HEADERS.nonce]!,
      signature: headers[PRINT_AUTH_HEADERS.signature]!,
      body,
      now,
    })).toMatchObject({ ok: true })
  })

  it('tryLanPrint ký exact request body cho agent LAN', async () => {
    const secret = '0123456789abcdef0123456789abcdef'
    await setLanPrintSecret(secret)
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const body = String(init?.body ?? '')
      const timestamp = headers.get(PRINT_AUTH_HEADERS.timestamp) ?? ''
      const nonce = headers.get(PRINT_AUTH_HEADERS.nonce) ?? ''
      const signature = headers.get(PRINT_AUTH_HEADERS.signature) ?? ''
      expect(verifyPrintSignature({
        secret,
        timestamp,
        nonce,
        signature,
        body,
        now: Number(timestamp),
      })).toMatchObject({ ok: true })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(tryLanPrint('http://192.168.1.20:9101', testTicket('Shop', 58))).resolves.toBe(true)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://192.168.1.20:9101/print')
  })

  it('không gửi request LAN từ xa khi thiết bị chưa có secret', async () => {
    await setLanPrintSecret('')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(tryLanPrint('http://192.168.1.20:9101', testTicket('Shop', 58))).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('localhost vẫn dùng được không secret trong chế độ mặc định', async () => {
    await setLanPrintSecret('')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get(PRINT_AUTH_HEADERS.signature)).toBeNull()
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(tryLanPrint('http://127.0.0.1:9101', testTicket('Shop', 58))).resolves.toBe(true)
  })
})
