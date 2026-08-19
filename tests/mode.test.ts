import { describe, it, expect } from 'vitest'
import { decideFlush } from '@/core/sync/mode'

const H = 3600 * 1000
const NOW = 1_000_000_000_000

describe('decideFlush', () => {
  it('local → không đẩy gì', () => {
    expect(decideFlush('local', 1, 0, NOW)).toEqual({ pushOps: false, pushSnapshot: false })
  })

  it('sync → pushOps khi outbox > 0', () => {
    expect(decideFlush('sync', 1, 0, NOW)).toEqual({ pushOps: true, pushSnapshot: false })
  })

  it('sync → không pushOps khi outbox = 0', () => {
    expect(decideFlush('sync', 0, 0, NOW)).toEqual({ pushOps: false, pushSnapshot: false })
  })

  it('sync → snapshot khi seq gap ≥ 20 dù outbox = 0', () => {
    expect(decideFlush('sync', 0, 0, NOW, 192, 20)).toEqual({ pushOps: false, pushSnapshot: true })
  })

  it('sync → đẩy op, chưa snapshot khi gap < 20', () => {
    expect(decideFlush('sync', 1, 0, NOW, 39, 20)).toEqual({ pushOps: true, pushSnapshot: false })
  })

  it('solo → đẩy op + snapshot khi outbox > 0 và quá 20h', () => {
    expect(decideFlush('solo', 1, NOW - 21 * H, NOW)).toEqual({ pushOps: true, pushSnapshot: true })
  })

  it('solo → đẩy op, chưa snapshot khi chưa quá 20h', () => {
    expect(decideFlush('solo', 1, NOW - 19 * H, NOW)).toEqual({ pushOps: true, pushSnapshot: false })
  })

  it('solo → không snapshot khi outbox = 0 dù quá 20h', () => {
    expect(decideFlush('solo', 0, NOW - 21 * H, NOW)).toEqual({ pushOps: false, pushSnapshot: false })
  })

  it('solo → snapshot khi outbox > 500 dù chưa quá 20h', () => {
    expect(decideFlush('solo', 501, NOW, NOW)).toEqual({ pushOps: true, pushSnapshot: true })
  })

  it('solo → đẩy op, chưa snapshot khi outbox = 500 và chưa quá 20h', () => {
    expect(decideFlush('solo', 500, NOW, NOW)).toEqual({ pushOps: true, pushSnapshot: false })
  })
})
