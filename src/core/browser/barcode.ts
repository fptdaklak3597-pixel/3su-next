/**
 * 3SU Next — Quét mã vạch
 * Native BarcodeDetector, sau 2.8s (hoặc khi thiếu) chuyển ZXing local.
 * Tra SP theo biến thể UPC-A / EAN-13 (leading zero).
 */
import type { Product } from '../types'

const ALL_FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8', 'itf', 'qr_code', 'upc_a', 'upc_e', 'data_matrix', 'aztec', 'pdf417']
const ONE_D_FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8', 'itf', 'upc_a', 'upc_e']
const ZXING_FALLBACK_MS = 2800
const ZXING_SRC = '/vendor/zxing-browser.min.js'

/* ─── Kiểm tra checksum EAN/UPC ─── */
export function verifyBarcodeChecksum(code: string): boolean {
  const s = String(code || '').trim()
  if (!/^\d+$/.test(s)) return true
  if (![8, 12, 13, 14].includes(s.length)) return true
  const digits = s.split('').map(Number)
  const check = digits.pop() as number
  let sum = 0
  for (let i = digits.length - 1, k = 0; i >= 0; i--, k++) {
    sum += digits[i] * (k % 2 === 0 ? 3 : 1)
  }
  return ((10 - (sum % 10)) % 10) === check
}

/** Bộ chấp nhận: mã lặp 2 lần HOẶC hợp lệ checksum thì nhận. */
function makeAcceptor(onAccept: (v: string) => void): (raw: string) => void {
  let last = ''
  let count = 0
  return (raw) => {
    const v = String(raw || '').trim()
    if (!v) return
    if (v === last) count++
    else { last = v; count = 1 }
    if (count >= 2 || verifyBarcodeChecksum(v)) onAccept(v)
  }
}

export function cameraErrorMessage(e: unknown): string {
  const n = (e as { name?: string })?.name || ''
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Chưa cấp quyền camera — vào Cài đặt site để cho phép'
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Không tìm thấy camera phù hợp'
  if (n === 'NotReadableError') return 'Camera đang được app khác sử dụng'
  return 'Không mở được camera'
}

async function openCameraStream(): Promise<MediaStream> {
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    throw Object.assign(new Error('getUserMedia missing'), { name: 'NotSupportedError' })
  }
  const constraints: MediaStreamConstraints[] = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    { video: { facingMode: { ideal: 'environment' } } },
    { video: true },
  ]
  let lastErr: unknown = null
  for (const c of constraints) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(c)
      try {
        const track = stream.getVideoTracks?.()[0]
        await track?.applyConstraints?.({ advanced: [{ focusMode: 'continuous' } as never] })
      } catch { /* */ }
      return stream
    } catch (e) {
      lastErr = e
      const n = (e as { name?: string })?.name
      if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'NotReadableError') throw e
    }
  }
  throw lastErr || new Error('camera open failed')
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike
type BarcodeDetectorNs = BarcodeDetectorCtor & { getSupportedFormats?: () => Promise<string[]> }

function getBarcodeDetector(): BarcodeDetectorNs | null {
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorNs }).BarcodeDetector ?? null
}

interface ZXingReader {
  decodeFromVideoElementContinuously?: (
    video: HTMLVideoElement,
    cb: (result: { getText: () => string } | undefined, err?: unknown) => void,
  ) => Promise<{ stop: () => void }>
  decodeFromVideoElement?: (
    video: HTMLVideoElement,
    cb: (result: { getText: () => string } | undefined, err?: unknown) => void,
  ) => Promise<{ stop: () => void }>
}

let zxLoad: Promise<{ BrowserMultiFormatReader: new () => ZXingReader }> | null = null

function loadZXing(): Promise<{ BrowserMultiFormatReader: new () => ZXingReader }> {
  if (zxLoad) return zxLoad
  zxLoad = new Promise((resolve, reject) => {
    const w = window as unknown as { ZXingBrowser?: { BrowserMultiFormatReader: new () => ZXingReader } }
    if (w.ZXingBrowser?.BrowserMultiFormatReader) {
      resolve(w.ZXingBrowser)
      return
    }
    const s = document.createElement('script')
    s.src = ZXING_SRC
    s.async = true
    s.onload = () => {
      if (w.ZXingBrowser?.BrowserMultiFormatReader) resolve(w.ZXingBrowser)
      else {
        zxLoad = null
        reject(new Error('ZXing UMD missing'))
      }
    }
    s.onerror = () => {
      zxLoad = null
      reject(new Error('Không tải được bộ quét local'))
    }
    document.head.appendChild(s)
  })
  return zxLoad
}

export interface ScanHandle {
  /** Promise resolve giá trị mã (rỗng nếu hủy). */
  promise: Promise<string>
  /** Gắn vào thẻ <video> để hiển thị luồng camera. */
  attach: (video: HTMLVideoElement) => void
  /** Dừng quét + tắt camera. */
  cancel: () => void
}

export interface ScanOpts {
  onError: (msg: string) => void
  onInfo?: (msg: string) => void
}

/**
 * Mở camera và quét mã vạch. Native trước, ZXing dự phòng.
 */
export async function createBarcodeScan(opts: ScanOpts = { onError: () => {} }): Promise<ScanHandle> {
  if (!window.isSecureContext) { opts.onError('Cần HTTPS để quét mã'); throw new Error('insecure') }

  let stream: MediaStream | null = null
  let finished = false
  let raf = 0
  let zxStop: (() => void) | null = null
  let resolveFn: (v: string) => void = () => {}

  const promise = new Promise<string>((res) => { resolveFn = res })

  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    try { zxStop?.() } catch { /* */ }
    zxStop = null
    try { stream?.getTracks().forEach((t) => t.stop()) } catch { /* */ }
  }
  const finish = (v: string) => {
    if (finished) return
    finished = true
    cleanup()
    resolveFn(v)
  }

  try {
    stream = await openCameraStream()
  } catch (e) {
    opts.onError(cameraErrorMessage(e))
    finish('')
    return { promise, attach: () => {}, cancel: () => finish('') }
  }

  const accept = makeAcceptor((v) => finish(v))

  const startZXing = async (video: HTMLVideoElement) => {
    if (finished || zxStop) return
    opts.onInfo?.('Đang dùng bộ giải mã dự phòng…')
    try {
      const ZX = await loadZXing()
      if (finished) return
      const reader = new ZX.BrowserMultiFormatReader()
      const cb = (result?: { getText: () => string }) => {
        if (result && !finished) accept(result.getText())
      }
      const controls = reader.decodeFromVideoElementContinuously
        ? await reader.decodeFromVideoElementContinuously(video, cb)
        : await reader.decodeFromVideoElement?.(video, cb)
      if (!controls) throw new Error('ZXing start failed')
      zxStop = () => { try { controls.stop() } catch { /* */ } }
    } catch {
      if (!finished) opts.onError('Không khởi động được bộ quét mã')
    }
  }

  const attach = (video: HTMLVideoElement) => {
    video.srcObject = stream
    video.playsInline = true
    video.muted = true
    video.setAttribute('playsinline', '')
    void video.play().catch(() => {})

    const Detector = getBarcodeDetector()
    const runNative = async () => {
      let supported: string[] = []
      try { supported = (await Detector?.getSupportedFormats?.()) ?? [] } catch { supported = [] }
      let formats = supported.length ? supported.filter((f) => ALL_FORMATS.includes(f)) : ALL_FORMATS
      const canTryOneDim = !supported.length || formats.some((f) => ONE_D_FORMATS.includes(f))
      let detector: BarcodeDetectorLike | null = null
      if (canTryOneDim && Detector) {
        try { detector = new Detector({ formats }) }
        catch { try { detector = new Detector() } catch { detector = null } }
      }
      if (!detector) {
        void startZXing(video)
        return
      }
      const started = Date.now()
      const tick = async () => {
        if (finished) return
        try {
          const codes = await detector!.detect(video)
          if (codes && codes.length) { accept(codes[0].rawValue); if (finished) return }
        } catch { /* bỏ qua frame lỗi */ }
        if (!zxStop && Date.now() - started > ZXING_FALLBACK_MS) {
          void startZXing(video)
          return
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    if (Detector) void runNative()
    else void startZXing(video)
  }

  return { promise, attach, cancel: () => finish('') }
}

/** Bỏ ký tự điều khiển / zero-width. */
export function compactBarcode(raw: string): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
}

/** Chuẩn hoá mã vạch (bỏ khoảng, gạch, chữ hoa). */
export function normalizeBarcode(code: string): string {
  return compactBarcode(code).replace(/[\s\-_.]/g, '').toUpperCase()
}

/** Biến thể cùng một mã (UPC-A ↔ EAN-13). */
export function barcodeVariants(raw: string): string[] {
  const compact = compactBarcode(raw)
  const normalized = normalizeBarcode(compact)
  const set = new Set<string>()
  if (compact) set.add(compact)
  if (normalized) set.add(normalized)
  if (/^\d+$/.test(normalized)) {
    if (normalized.length === 12) set.add('0' + normalized)
    if (normalized.length === 13 && normalized.startsWith('0')) set.add(normalized.slice(1))
  }
  return [...set]
}

/** Tìm sản phẩm theo mã vạch (kể cả biến thể leading zero). */
export function findProductByBarcode(code: string, products: Product[]): Product | null {
  const vars = new Set(barcodeVariants(code))
  if (!vars.size) return null
  for (const p of products) {
    if (!p.barcode || p.deleted) continue
    for (const v of barcodeVariants(p.barcode)) {
      if (vars.has(v)) return p
    }
  }
  return null
}
