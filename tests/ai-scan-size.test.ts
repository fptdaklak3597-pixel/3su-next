import { describe, expect, it } from 'vitest'
import { fitScanSize } from '@/core/ai/client'

describe('fitScanSize', () => {
  it('scales the long edge to 1600', () => {
    expect(fitScanSize(4000, 3000)).toEqual({ w: 1600, h: 1200 })
  })

  it('leaves smaller images unchanged', () => {
    expect(fitScanSize(800, 600)).toEqual({ w: 800, h: 600 })
  })
})
