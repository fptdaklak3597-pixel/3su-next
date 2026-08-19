import { describe, expect, it } from 'vitest'
import { createHidScanner, HID_SCAN_GAP_MS, isBarcodeLike } from '@/core/browser/hidBarcode'

function burst(hid: ReturnType<typeof createHidScanner>, code: string, start = 1000) {
  let t = start
  let last = hid.push({ key: code[0], time: t })
  for (let i = 1; i < code.length; i++) {
    t += HID_SCAN_GAP_MS - 5
    last = hid.push({ key: code[i], time: t })
  }
  return { last, t }
}

describe('HID barcode buffer', () => {
  it('không nhận 6 số giữa chừng — chờ Enter', () => {
    const hid = createHidScanner()
    const { last } = burst(hid, '893458')
    expect(last.code).toBeUndefined()
    expect(last.pendingIdle).toBe(true)
  })

  it('Enter sau burst EAN-13 thì commit', () => {
    const hid = createHidScanner()
    const { t } = burst(hid, '8934588012220')
    const r = hid.push({ key: 'Enter', time: t + 10 })
    expect(r.code).toBe('8934588012220')
    expect(r.consume).toBe(true)
  })

  it('gõ tay chậm không thành mã', () => {
    const hid = createHidScanner()
    hid.push({ key: '1', time: 0 })
    hid.push({ key: '2', time: 200 })
    const r = hid.push({ key: 'Enter', time: 400 })
    expect(r.code).toBeUndefined()
  })

  it('idle flush khi súng không gửi Enter', () => {
    const hid = createHidScanner()
    burst(hid, '8934588012220')
    expect(hid.flushIdle()).toBe('8934588012220')
  })

  it('bỏ qua textarea', () => {
    const hid = createHidScanner()
    const r = hid.push({ key: '1', time: 1, tag: 'TEXTAREA' })
    expect(r.consume).toBe(false)
  })

  it('isBarcodeLike', () => {
    expect(isBarcodeLike('12345')).toBe(false)
    expect(isBarcodeLike('123456')).toBe(true)
    expect(isBarcodeLike('ABC-12.3')).toBe(true)
  })
})
