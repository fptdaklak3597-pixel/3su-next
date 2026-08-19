import { describe, it, expect } from 'vitest'
import { hlcString, parseHlc, compareHlc, createHlcClock } from '@/core/sync/hlc'

describe('hlc', () => {
  it('format cố định 13 số ms + 4 hex counter + deviceId, so sánh chuỗi = so sánh thời gian', () => {
    const a = hlcString(1_755_150_000_000, 3, 'dev_a')
    expect(a).toBe('1755150000000-0003-dev_a')
    expect(parseHlc(a)).toEqual({ ms: 1_755_150_000_000, c: 3, d: 'dev_a' })
    expect(compareHlc(hlcString(1000, 0, 'x'), hlcString(1001, 0, 'x'))).toBe(-1)
    expect(compareHlc(hlcString(1000, 2, 'x'), hlcString(1000, 1, 'x'))).toBe(1)
  })

  it('next() luôn tăng nghiêm ngặt, kể cả khi đồng hồ máy đứng yên hoặc LÙI', () => {
    let t = 5000
    const clock = createHlcClock('dev_a', null, () => {}, () => t)
    const h1 = clock.next()
    t = 4000 // đồng hồ lùi 1 giây
    const h2 = clock.next()
    const h3 = clock.next()
    expect(compareHlc(h2, h1)).toBe(1)
    expect(compareHlc(h3, h2)).toBe(1)
  })

  it('observe(remote) đẩy đồng hồ vượt op remote — op sau đó phải mới hơn remote', () => {
    let t = 1000
    const clock = createHlcClock('dev_a', null, () => {}, () => t)
    const remote = hlcString(999_999, 10, 'dev_b')
    clock.observe(remote)
    expect(compareHlc(clock.next(), remote)).toBe(1)
  })

  it('khôi phục từ persisted vẫn monotonic', () => {
    const persisted = hlcString(9000, 5, 'dev_a')
    const clock = createHlcClock('dev_a', persisted, () => {}, () => 1000)
    expect(compareHlc(clock.next(), persisted)).toBe(1)
  })

  it('gọi persist mỗi lần next', () => {
    const saved: string[] = []
    const clock = createHlcClock('dev_a', null, (s) => saved.push(s))
    const h = clock.next()
    expect(saved).toEqual([h])
  })
})
