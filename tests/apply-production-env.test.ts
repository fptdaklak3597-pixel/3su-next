import { describe, expect, it } from 'vitest'
import { applyProductionEnvForAppBuild } from '../scripts/apply-production-env'

const production = {
  VITE_API_BASE: 'https://3su-cloud.example',
  VITE_FIREBASE_API_KEY: 'prod-key',
  VITE_FIREBASE_APP_ID: '1:1:web:prod',
  OTHER: 'ignore',
}

describe('applyProductionEnvForAppBuild', () => {
  it('nhúng env production khi build mobile/admin', () => {
    const mobile = applyProductionEnvForAppBuild('build', 'mobile', {}, production)
    expect(mobile.VITE_FIREBASE_API_KEY).toBe('prod-key')
    expect(mobile.VITE_API_BASE).toBe('https://3su-cloud.example')
    expect(mobile.OTHER).toBeUndefined()

    const admin = applyProductionEnvForAppBuild('build', 'admin', {}, production)
    expect(admin.VITE_FIREBASE_APP_ID).toBe('1:1:web:prod')
  })

  it('không ghi đè VITE_* đã có, không đụng dev/web', () => {
    const kept = applyProductionEnvForAppBuild('build', 'mobile', { VITE_API_BASE: 'http://127.0.0.1:8787' }, production)
    expect(kept.VITE_API_BASE).toBe('http://127.0.0.1:8787')
    expect(kept.VITE_FIREBASE_API_KEY).toBe('prod-key')

    expect(applyProductionEnvForAppBuild('serve', 'mobile', {}, production)).toEqual({})
    expect(applyProductionEnvForAppBuild('build', 'production', {}, production)).toEqual({})
  })
})
