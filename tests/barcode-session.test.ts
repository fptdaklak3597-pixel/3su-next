import { describe, expect, it } from 'vitest'
import { createScanSession } from '@/core/browser/barcodeSession'

describe('barcode scan session', () => {
  it('cancels an adopted handle when cancelled before adoption', () => {
    const session = createScanSession()
    session.cancel()
    let handleCancelled = false

    session.adopt({
      cancel: () => {
        handleCancelled = true
      },
    })

    expect(handleCancelled).toBe(true)
  })

  it('cancels an adopted handle when cancelled after adoption', () => {
    const session = createScanSession()
    let handleCancelled = false
    session.adopt({
      cancel: () => {
        handleCancelled = true
      },
    })
    session.cancel()
    expect(handleCancelled).toBe(true)
    expect(session.cancelled).toBe(true)
  })
})
