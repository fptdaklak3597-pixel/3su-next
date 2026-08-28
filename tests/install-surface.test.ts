import { describe, expect, it } from 'vitest'
import { installSurface, isApplePhoneOrTablet } from '@/shared/pwa'

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

describe('installSurface', () => {
  it('ưu tiên native khi Chrome đã bắn beforeinstallprompt', () => {
    expect(installSurface(true, IPHONE_SAFARI)).toBe('native')
    expect(installSurface(true, ANDROID_CHROME)).toBe('native')
  })

  it('iPhone Safari → sheet 3 bước', () => {
    expect(installSurface(false, IPHONE_SAFARI)).toBe('ios-safari')
  })

  it('iPhone Chrome → bảo mở Safari', () => {
    expect(installSurface(false, IPHONE_CHROME)).toBe('ios-other')
  })

  it('Android không có prompt → hướng dẫn menu Chrome', () => {
    expect(installSurface(false, ANDROID_CHROME)).toBe('manual')
  })

  it('iPadOS (Macintosh + touch) là máy Apple', () => {
    expect(isApplePhoneOrTablet(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      { platform: 'MacIntel', maxTouchPoints: 5 },
    )).toBe(true)
    expect(installSurface(
      false,
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      { platform: 'MacIntel', maxTouchPoints: 5 },
    )).toBe('ios-safari')
  })
})
