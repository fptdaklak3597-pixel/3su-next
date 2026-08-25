import { describe, expect, it } from 'vitest'
import {
  firebasePublicFromEnv,
  isFirebaseInitReady,
  resolveAuthDomain,
} from '../functions/firebase-init-core.js'

describe('firebase init.json (Pages Function)', () => {
  const env = {
    VITE_FIREBASE_API_KEY: 'test-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'su-next.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'su-next',
    VITE_FIREBASE_APP_ID: '1:1:web:test',
    VITE_FIREBASE_STORAGE_BUCKET: 'su-next.firebasestorage.app',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
  }

  it('resolveAuthDomain khớp client', () => {
    expect(resolveAuthDomain('su-next.firebaseapp.com', '3su.shop')).toBe('3su.shop')
    expect(resolveAuthDomain('su-next.firebaseapp.com', 'evil.example')).toBe('su-next.firebaseapp.com')
  })

  it('build init payload đủ field bắt buộc', () => {
    const cfg = firebasePublicFromEnv(env, '3su.shop')
    expect(cfg.authDomain).toBe('3su.shop')
    expect(isFirebaseInitReady(cfg)).toBe(true)
    expect(cfg.apiKey).toBe('test-key')
    expect(cfg.projectId).toBe('su-next')
  })

  it('thiếu apiKey → không serve init.json', () => {
    expect(isFirebaseInitReady(firebasePublicFromEnv({}, '3su.shop'))).toBe(false)
  })
})
