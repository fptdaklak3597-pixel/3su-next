/**
 * 3SU Next — Ghi lỗi tập trung
 * Port từ 00-error-logger.js: sanitize secrets, gom lỗi trùng, buffer giới hạn.
 * KHÔNG gửi stack/secret ra ngoài. Cloud reporting qua sync engine riêng.
 */

export interface ErrorRecord {
  t: string
  tag: string
  msg: string
  stack: string
  n: number
}

const MAX_BUFFER = 200
const buffer: ErrorRecord[] = []

/** SECURITY: Strip API keys, passwords, tokens khỏi message/stack */
function sanitize(s: string): string {
  try {
    let out = String(s || '')
    out = out.replace(/sk-ant-[A-Za-z0-9_\-]+/g, '[REDACTED_API_KEY]')
    out = out.replace(/AIza[0-9A-Za-z_\-]+/g, '[REDACTED_FIREBASE_KEY]')
    out = out.replace(/("?(?:password|pass|pw|secret|token|apiKey|aiKey)"?\s*[:=]\s*")([^"]+)(")/gi, '$1[REDACTED]$3')
    out = out.replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    // Firebase config keys
    out = out.replace(/(firebaseConfig["\s:=]+{)[^}]+}/gi, '$1[REDACTED]}')
    return out
  } catch {
    return ''
  }
}

export function logError(err: unknown, tag = ''): void {
  try {
    const e = err instanceof Error ? err : new Error(String(err))
    const msg = sanitize(e.message).slice(0, 500)
    const stack = sanitize(e.stack || '').slice(0, 1200)

    // Gom lỗi trùng (tag|msg)
    const key = tag + '|' + msg.slice(0, 200)
    const existing = buffer.find((r) => (r.tag + '|' + r.msg.slice(0, 200)) === key)
    if (existing) {
      existing.n += 1
      existing.t = new Date().toISOString()
      existing.stack = stack
      return
    }

    buffer.push({ t: new Date().toISOString(), tag, msg, stack, n: 1 })
    if (buffer.length > MAX_BUFFER) buffer.shift()

    // Persist 50 lỗi gần nhất để debug sau
    try {
      localStorage.setItem('3su_errLog', JSON.stringify(buffer.slice(-50)))
    } catch { /* quota — bỏ qua */ }

    if (import.meta.env.DEV) {
      console.warn('[3SU:err]', tag, err)
    }
  } catch { /* không bao giờ để logger tự crash app */ }
}

export function getErrorLog(): ErrorRecord[] {
  return [...buffer]
}

export function exportErrorLogText(): string {
  const rows = getErrorLog()
  if (!rows.length) return 'Không có lỗi'
  return rows.map((r) => `${r.t} [${r.tag}] ×${r.n} ${r.msg}`).join('\n')
}

export function clearErrorLog(): void {
  buffer.length = 0
  try { localStorage.removeItem('3su_errLog') } catch { /* */ }
}

/** Cài đặt global handlers — gọi 1 lần ở main */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (e) => {
    logError(e.error || e.message, 'window.error')
  })
  window.addEventListener('unhandledrejection', (e) => {
    logError(e.reason, 'promise')
  })
}

/* ─── Sync health watchdog (port __syncHealth) ─── */
export const syncHealth = {
  lastPushOk: 0,
  lastPushErr: 0,
  lastPullOk: 0,
  lastErr: '',
  pushOk() { this.lastPushOk = Date.now() },
  pushErr(e: unknown) {
    this.lastPushErr = Date.now()
    this.lastErr = sanitize(String((e instanceof Error ? e.message : e) || '')).slice(0, 300)
  },
  pullOk() { this.lastPullOk = Date.now() },
}
