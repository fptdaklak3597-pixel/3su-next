import { describe, expect, it } from 'vitest'
import { isLicenseBlocked, licenseFromApiError } from '@/core/sync/license'

describe('shop license', () => {
  // useShopLicense reset fetched đồng bộ khi enabled đổi — không test hook ở đây.
  it('blocks locked and expired', () => {
    expect(isLicenseBlocked({ status: 'locked', expiresAt: null })).toBe(true)
    expect(isLicenseBlocked({ status: 'expired', expiresAt: Date.now() + 99_000 })).toBe(true)
    expect(isLicenseBlocked({ status: 'active', expiresAt: Date.now() - 1 })).toBe(true)
    expect(isLicenseBlocked({ status: 'active', expiresAt: null })).toBe(false)
    expect(isLicenseBlocked({ status: 'trial', expiresAt: Date.now() + 60_000 })).toBe(false)
    expect(isLicenseBlocked(null)).toBe(false)
  })

  it('maps API error codes', () => {
    expect(licenseFromApiError('SHOP_LOCKED')?.status).toBe('locked')
    expect(licenseFromApiError('SHOP_EXPIRED')?.status).toBe('expired')
    expect(licenseFromApiError('Không thuộc cửa hàng này')).toBeNull()
  })
})
