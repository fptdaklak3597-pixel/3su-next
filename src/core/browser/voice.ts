/**
 * 3SU Next — Nhập bằng giọng nói (Voice input)
 * Port từ 18b-voice.js: SpeechRecognition vi-VN + parse số tiếng Việt + tìm SP.
 *
 * Luồng: nghe → parseVoice(text) → [{name, qty}] → khớp sản phẩm → thêm giỏ.
 */
import type { Product } from '../types'

/* ─── Parse số tiếng Việt ─── */
const VI_NUMS: Record<string, number> = {
  'không': 0, 'một': 1, 'hai': 2, 'ba': 3, 'bốn': 4, 'năm': 5,
  'sáu': 6, 'bảy': 7, 'tám': 8, 'chín': 9, 'mười': 10, 'mốt': 1, 'tư': 4, 'lăm': 5,
}

/** Parse số lượng ở đầu chuỗi từ. Trả về qty + số từ đã dùng. */
function isHalf(w: string): boolean {
  return w === 'rưỡi' || w === 'ruoi'
}
function isTen(w: string): boolean {
  return w === 'chục' || w === 'chuc'
}

export function parseQty(words: string[]): { qty: number; consumed: number } {
  const w0 = (words[0] || '').toLowerCase()
  const w1 = (words[1] || '').toLowerCase()
  if (/^\d+$/.test(w0)) return { qty: parseInt(w0, 10), consumed: 1 }
  if (isHalf(w0)) return { qty: 0.5, consumed: 1 }
  if (isTen(w0)) return { qty: 10, consumed: 1 }
  // "mười một" = 11
  if (w0 === 'mười' && VI_NUMS[w1] !== undefined) return { qty: 10 + VI_NUMS[w1], consumed: 2 }
  // "hai mươi", "hai mươi mốt" = 20, 21
  if (VI_NUMS[w0] !== undefined && w1 === 'mươi') {
    const w2 = (words[2] || '').toLowerCase()
    if (VI_NUMS[w2] !== undefined) return { qty: VI_NUMS[w0] * 10 + VI_NUMS[w2], consumed: 3 }
    return { qty: VI_NUMS[w0] * 10, consumed: 2 }
  }
  if (VI_NUMS[w0] !== undefined && isHalf(w1)) return { qty: VI_NUMS[w0] + 0.5, consumed: 2 }
  if (VI_NUMS[w0] !== undefined && isTen(w1)) return { qty: VI_NUMS[w0] * 10, consumed: 2 }
  if (VI_NUMS[w0] !== undefined) return { qty: VI_NUMS[w0], consumed: 1 }
  return { qty: 1, consumed: 0 }
}

const UNIT_PREFIX = /^(gói|chai|cái|hộp|ký|kg|lon|bịch|cuốn|quả|trái|bao|túi|lọ|thùng|lốc)\s+/

export interface ParsedItem {
  name: string
  qty: number
}

/**
 * Parse câu lệnh bán hàng thành danh sách món.
 * VD: "3 mì, 1 coca" → [{name:'mì',qty:3},{name:'coca',qty:1}]
 */
export function parseCommand(text: string): ParsedItem[] {
  const raw = text
    .toLowerCase()
    .replace(/[.,!?]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bvà\b/g, ',')
    .replace(/ thêm /g, ',')
    .trim()
  const segs = raw.split(',').map((s) => s.trim()).filter(Boolean)
  const out: ParsedItem[] = []
  for (const seg of segs) {
    const words = seg.split(' ')
    const { qty, consumed } = parseQty(words)
    let rest = words.slice(consumed).join(' ')
    rest = rest.replace(UNIT_PREFIX, '').trim()
    // bỏ từ đệm bán hàng
    rest = rest.replace(/^(bán|cho|lấy|thêm)\s+/, '').trim()
    if (!rest) continue
    out.push({ name: rest, qty: qty > 0 ? qty : 1 })
  }
  return out
}

/** Khớp tên (đã chuẩn hoá) với sản phẩm: exact → contains → từ đầu. */
export function findProductByName(text: string, products: Product[]): Product | null {
  const t = text.toLowerCase().trim()
  if (!t) return null
  let p = products.find((x) => x.name.toLowerCase() === t)
  if (p) return p
  p = products.find((x) => x.name.toLowerCase().includes(t) || t.includes(x.name.toLowerCase()))
  if (p) return p
  const first = t.split(' ')[0]
  p = products.find((x) => x.name.toLowerCase().split(' ').includes(first))
  return p ?? null
}

/* ─── SpeechRecognition ─── */
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((e: SpeechResultEvent) => void) | null
  onerror: ((e: { error?: string; message?: string }) => void) | null
  onend: (() => void) | null
}

interface SpeechResultEvent {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

function getSR(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function voiceSupported(): boolean {
  return getSR() !== null
}

/** Kiểm tra chặn trong in-app browser (Zalo/FB/Instagram…). */
function isInAppBrowser(): boolean {
  const ua = navigator.userAgent || ''
  return /FBAN|FBAV|FB_IAB|Instagram|Zalo|Line\/|MicroMessenger|TikTok|Twitter|Snapchat/i.test(ua)
}

/** Xin quyền mic qua getUserMedia (đáng tin hơn permissions.query trên WebKit). */
async function ensureMic(): Promise<{ ok: boolean; msg?: string }> {
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    return { ok: false, msg: 'Trình duyệt này chưa hỗ trợ mic — mở bằng Chrome' }
  }
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    try { s.getTracks().forEach((t) => t.stop()) } catch { /* */ }
    return { ok: true }
  } catch (e) {
    const n = (e as { name?: string })?.name || ''
    if (n === 'NotAllowedError' || n === 'SecurityError') return { ok: false, msg: 'Chưa cấp quyền mic — bấm "Cho phép" khi trình duyệt hỏi' }
    if (n === 'NotFoundError') return { ok: false, msg: 'Không tìm thấy mic trên máy' }
    return { ok: false, msg: 'Lỗi mic: ' + (n || '') }
  }
}

export interface ListenHandlers {
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (msg: string) => void
}

/**
 * Bắt đầu nghe. Trả về hàm dừng.
 * onFinal nhận văn bản cuối cùng để parseCommand.
 */
export async function startListening(h: ListenHandlers): Promise<(() => void) | null> {
  if (!window.isSecureContext) { h.onError('Cần HTTPS hoặc localhost để dùng giọng nói'); return null }
  if (isInAppBrowser()) { h.onError('Trình duyệt trong ứng dụng không cho dùng mic — mở bằng Chrome'); return null }
  const SR = getSR()
  if (!SR) {
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent)
    h.onError(ios
      ? 'Máy không nghe — iPhone chỉ dùng giọng nói trên Safari, không phải app ghim hay Chrome'
      : 'Trình duyệt này chưa hỗ trợ giọng nói — thử Chrome')
    return null
  }

  const mic = await ensureMic()
  if (!mic.ok) { h.onError(mic.msg || 'Lỗi mic'); return null }

  const recog = new SR()
  recog.lang = 'vi-VN'
  recog.interimResults = true
  recog.continuous = false
  let finalText = ''

  recog.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) finalText += t
      else interim += t
    }
    h.onInterim((finalText + ' ' + interim).trim())
  }
  recog.onerror = (e) => {
    const code = e.error || ''
    if (code === 'aborted' || code === 'no-speech') return
    if (code === 'not-allowed') h.onError('Chưa cấp quyền mic — bấm lại và chọn "Cho phép"')
    else if (code === 'network') h.onError('Cần kết nối mạng để nhận giọng nói')
    else if (code === 'audio-capture') h.onError('Không truy cập được mic')
    else h.onError('Lỗi giọng nói: ' + code)
  }
  recog.onend = () => {
    if (finalText.trim()) h.onFinal(finalText.trim())
  }

  try {
    recog.start()
  } catch {
    h.onError('Không khởi động được giọng nói — thử lại')
    return null
  }
  return () => { try { recog.stop() } catch { /* */ } }
}
