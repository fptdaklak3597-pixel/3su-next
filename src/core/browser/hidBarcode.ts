/**
 * Súng quét USB/BT kiểu bàn phím (HID wedge).
 * Nhận chuỗi gõ rất nhanh + Enter; không kích khi gõ tay chậm.
 * Không commit giữa chừng (tránh EAN-13 bị cắt ở 6 số).
 */

export const HID_SCAN_GAP_MS = 45
export const HID_IDLE_MS = 80
export const HID_MIN_LEN = 6

export function isBarcodeLike(raw: string): boolean {
  const s = String(raw || '').trim()
  if (s.length < HID_MIN_LEN || s.length > 64) return false
  return /^[0-9A-Za-z\-_./]+$/.test(s)
}

export interface HidKey {
  key: string
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  time: number
  tag?: string
  isContentEditable?: boolean
}

export interface HidPushResult {
  /** Chặn keydown — đang trong burst súng quét. */
  consume: boolean
  /** Có thể commit sau idle (gọi flushIdle). */
  pendingIdle: boolean
  /** Mã vừa xong (Enter hoặc caller flush). */
  code?: string
}

/**
 * Bộ đệm HID thuần (dễ test). Wrapper DOM gọi setTimeout(flushIdle).
 */
export function createHidScanner() {
  let buf = ''
  let lastTs = 0
  let burst = false

  function reset(): void {
    buf = ''
    burst = false
    lastTs = 0
  }

  function take(): string | undefined {
    const code = buf
    reset()
    if (isBarcodeLike(code)) return code
    return undefined
  }

  function push(e: HidKey): HidPushResult {
    if (e.ctrlKey || e.altKey || e.metaKey) return { consume: false, pendingIdle: false }
    const tag = (e.tag || '').toUpperCase()
    if (tag === 'TEXTAREA' || e.isContentEditable) return { consume: false, pendingIdle: false }

    if (e.key === 'Enter') {
      if (burst && buf.length >= HID_MIN_LEN) {
        const code = take()
        return { consume: !!code, pendingIdle: false, code }
      }
      reset()
      return { consume: false, pendingIdle: false }
    }

    if (e.key.length !== 1 || !/^[0-9A-Za-z\-_./]$/.test(e.key)) {
      reset()
      return { consume: false, pendingIdle: false }
    }

    const gap = e.time - lastTs
    if (!lastTs || gap > HID_SCAN_GAP_MS) {
      buf = e.key
      burst = false
      lastTs = e.time
      return { consume: false, pendingIdle: false }
    }

    buf += e.key
    burst = true
    lastTs = e.time
    return { consume: true, pendingIdle: buf.length >= HID_MIN_LEN }
  }

  function flushIdle(): string | undefined {
    if (!burst || buf.length < HID_MIN_LEN) return undefined
    return take()
  }

  return { push, flushIdle, reset }
}

/** Gỡ mã vừa dính vào ô đang focus (ký tự đầu burst lọt trước khi steal). */
export function stripBarcodeFromActive(code: string): void {
  const el = document.activeElement
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return
  const v = el.value
  if (!v) return
  let next = v
  if (v === code || v.endsWith(code)) next = v.slice(0, Math.max(0, v.length - code.length))
  else if (code.startsWith(v) && code.length > v.length) next = ''
  if (next === v) return
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
  desc?.set?.call(el, next)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Lắng nghe súng quét toàn trang (capture). Trả về hàm gỡ. */
export function attachHidBarcode(onScan: (code: string) => void): () => void {
  const hid = createHidScanner()
  let idle: ReturnType<typeof setTimeout> | null = null

  const emit = (code: string) => {
    stripBarcodeFromActive(code)
    onScan(code)
  }

  const onKey = (ev: KeyboardEvent) => {
    const target = ev.target as HTMLElement | null
    const r = hid.push({
      key: ev.key,
      ctrlKey: ev.ctrlKey,
      altKey: ev.altKey,
      metaKey: ev.metaKey,
      time: ev.timeStamp || Date.now(),
      tag: target?.tagName,
      isContentEditable: !!target?.isContentEditable,
    })
    if (idle) { clearTimeout(idle); idle = null }
    if (r.consume) ev.preventDefault()
    if (r.code) {
      ev.preventDefault()
      emit(r.code)
      return
    }
    if (r.pendingIdle) {
      idle = setTimeout(() => {
        const code = hid.flushIdle()
        if (code) emit(code)
      }, HID_IDLE_MS)
    }
  }

  window.addEventListener('keydown', onKey, true)
  return () => {
    window.removeEventListener('keydown', onKey, true)
    if (idle) clearTimeout(idle)
    hid.reset()
  }
}
