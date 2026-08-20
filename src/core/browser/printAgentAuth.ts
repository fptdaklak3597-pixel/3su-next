import { getMeta, setMeta } from '../db'

const SECRET_META_KEY = 'print:lanSecret'
const MIN_SECRET_LENGTH = 16
const MAX_SECRET_LENGTH = 256

export const PRINT_AUTH_HEADERS = {
  timestamp: 'X-3SU-Timestamp',
  nonce: 'X-3SU-Nonce',
  signature: 'X-3SU-Signature',
} as const

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

function textBuffer(value: string): ArrayBuffer {
  return ownedBuffer(new TextEncoder().encode(value))
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export function normalizeLanAgentUrl(value: string): string {
  const clean = value.trim()
  if (!clean) return ''
  let url: URL
  try { url = new URL(clean) } catch { throw new Error('Địa chỉ LAN Agent không hợp lệ') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('LAN Agent chỉ hỗ trợ http/https')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Địa chỉ LAN Agent không được chứa tài khoản, query hoặc fragment')
  }
  const pathname = url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host}${pathname === '/' ? '' : pathname}`
}

export function isLoopbackLanAgentUrl(value: string): boolean {
  const normalized = normalizeLanAgentUrl(value)
  if (!normalized) return false
  const host = new URL(normalized).hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

export function lanAgentNeedsSecret(value: string): boolean {
  const normalized = normalizeLanAgentUrl(value)
  return !!normalized && !isLoopbackLanAgentUrl(normalized)
}

export function validateLanPrintSecret(value: string): string {
  const secret = value.trim()
  if (!secret) return ''
  if (secret.length < MIN_SECRET_LENGTH) throw new Error('Secret máy in tối thiểu 16 ký tự')
  if (secret.length > MAX_SECRET_LENGTH) throw new Error('Secret máy in quá dài')
  return secret
}

export async function getLanPrintSecret(): Promise<string> {
  const value = await getMeta<unknown>(SECRET_META_KEY, '')
  return typeof value === 'string' ? value : ''
}

export async function setLanPrintSecret(value: string): Promise<void> {
  const secret = validateLanPrintSecret(value)
  if (!secret) {
    await setMeta(SECRET_META_KEY, '')
    return
  }
  await setMeta(SECRET_META_KEY, secret)
}

export function generateLanPrintSecret(): string {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Thiết bị không hỗ trợ sinh secret an toàn')
  }
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

export function generatePrintNonce(): string {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Thiết bị không hỗ trợ nonce an toàn')
  }
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '')
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

export async function hmacPrintBody(
  secret: string,
  timestamp: string,
  nonce: string,
  body: string,
): Promise<string> {
  const safeSecret = validateLanPrintSecret(secret)
  if (!safeSecret) throw new Error('Thiếu secret máy in')
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Thiết bị không hỗ trợ HMAC')
  }
  const key = await crypto.subtle.importKey(
    'raw',
    textBuffer(safeSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textBuffer(`${timestamp}.${nonce}.${body}`),
  )
  return bytesToHex(new Uint8Array(signature))
}

export async function signedLanPrintHeaders(
  secret: string,
  body: string,
  options: { now?: number; nonce?: string } = {},
): Promise<Record<string, string>> {
  const timestamp = String(Math.trunc(options.now ?? Date.now()))
  const nonce = options.nonce ?? generatePrintNonce()
  return {
    [PRINT_AUTH_HEADERS.timestamp]: timestamp,
    [PRINT_AUTH_HEADERS.nonce]: nonce,
    [PRINT_AUTH_HEADERS.signature]: await hmacPrintBody(secret, timestamp, nonce, body),
  }
}

export async function validateLanAgentConfiguration(agentUrl: string, secret?: string): Promise<{
  url: string
  secret: string
}> {
  const url = normalizeLanAgentUrl(agentUrl)
  const resolvedSecret = validateLanPrintSecret(secret ?? await getLanPrintSecret())
  if (url && lanAgentNeedsSecret(url) && !resolvedSecret) {
    throw new Error('Địa chỉ LAN cần secret giống PRINT_AGENT_SECRET trên máy in')
  }
  return { url, secret: resolvedSecret }
}
