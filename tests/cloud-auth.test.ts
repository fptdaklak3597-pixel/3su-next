import { describe, expect, it, vi } from 'vitest'
import {
  classifyCloudUser,
  CLOUD_MAIL_FROM,
  cloudAuthMessage,
  cloudMailHint,
  isCloudEmailPending,
} from '@/core/sync/cloudAuth'
import { firebaseOptions, googleSignInMode, isCursorUserAgent, resolveAuthDomain } from '@/core/sync/firebaseConfig'

describe('cloud email gate', () => {
  it('holds password users until verified', () => {
    const pending = { emailVerified: false, providerData: [{ providerId: 'password' }] }
    expect(isCloudEmailPending(pending)).toBe(true)
    expect(classifyCloudUser(pending)).toBe('verify')
    expect(classifyCloudUser({ emailVerified: true, providerData: [{ providerId: 'password' }] })).toBe('in')
  })

  it('lets Google in without a verify step', () => {
    const google = { emailVerified: false, providerData: [{ providerId: 'google.com' }] }
    expect(isCloudEmailPending(google)).toBe(false)
    expect(classifyCloudUser(google)).toBe('in')
  })

  it('maps firebase errors and names the shop mailbox', () => {
    expect(CLOUD_MAIL_FROM).toBe('3su.shop@gmail.com')
    expect(cloudMailHint('verify')).toContain(CLOUD_MAIL_FROM)
    expect(cloudMailHint('reset')).toContain(CLOUD_MAIL_FROM)
    expect(cloudAuthMessage({ code: 'auth/missing-email' })).toMatch(/Nhập lại email/)
    expect(cloudAuthMessage({ code: 'auth/expired-action-code' })).toMatch(/hết hạn/)
    expect(cloudAuthMessage({ code: 'auth/no-auth-event' })).toMatch(/Google/)
    expect(cloudAuthMessage({ code: 'auth/internal-error' })).toMatch(/Firebase/)
    expect(cloudAuthMessage(new Error('Unable to process request due to missing initial state'))).toMatch(/Google/)
    expect(cloudAuthMessage(new Error('Error 400: origin_mismatch'))).toMatch(/origin/)
    expect(cloudAuthMessage(new Error('gis-timeout'))).toMatch(/Chrome/)
  })
})

describe('authDomain cùng origin', () => {
  it('uses the Pages host so Google redirect keeps sessionStorage', () => {
    expect(resolveAuthDomain('su-next.firebaseapp.com', 'su-next-web.pages.dev')).toBe('su-next-web.pages.dev')
    expect(resolveAuthDomain('su-next.firebaseapp.com', 'su-next-app.pages.dev')).toBe('su-next-app.pages.dev')
    expect(resolveAuthDomain('su-next.firebaseapp.com', '3su.shop')).toBe('3su.shop')
    expect(resolveAuthDomain('su-next.firebaseapp.com', 'www.3su.shop')).toBe('www.3su.shop')
    expect(resolveAuthDomain('su-next.firebaseapp.com', 'app.3su.shop')).toBe('app.3su.shop')
    // localhost http không dùng được — SDK ép https cho handler, giữ authDomain env
    expect(resolveAuthDomain('su-next.firebaseapp.com', 'localhost')).toBe('su-next.firebaseapp.com')
    expect(resolveAuthDomain('su-next.firebaseapp.com', 'localhost:5190')).toBe('su-next.firebaseapp.com')
    expect(resolveAuthDomain('su-next.firebaseapp.com', 'evil.example')).toBe('su-next.firebaseapp.com')
  })

  it('firebaseOptions dùng resolveAuthDomain, không cứng firebaseapp.com', () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-key')
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'su-next')
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:1:web:test')
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'su-next.firebaseapp.com')
    const pages = firebaseOptions('su-next-web.pages.dev')
    const app = firebaseOptions('su-next-app.pages.dev')
    const shop = firebaseOptions('3su.shop')
    const local = firebaseOptions('localhost')
    expect(pages?.authDomain).toBe('su-next-web.pages.dev')
    expect(app?.authDomain).toBe('su-next-app.pages.dev')
    expect(shop?.authDomain).toBe('3su.shop')
    expect(local?.authDomain).toBe('su-next.firebaseapp.com')
    vi.unstubAllEnvs()
  })

  it('webview localhost dùng GIS — không redirect firebaseapp.com', () => {
    expect(googleSignInMode('su-next.firebaseapp.com', 'localhost', true)).toBe('gis')
    expect(googleSignInMode('su-next-web.pages.dev', 'su-next-web.pages.dev', true)).toBe('redirect')
    expect(googleSignInMode('su-next.firebaseapp.com', 'localhost', false)).toBe('popup')
    expect(googleSignInMode('su-next-web.pages.dev', 'su-next-web.pages.dev', false)).toBe('popup')
  })

  it('nhận diện Cursor/Electron từ userAgent — không cần probe popup', () => {
    expect(isCursorUserAgent('Mozilla/5.0 Cursor/3.16.17 Chrome/144.0.7559.236 Electron/40.10.3')).toBe(true)
    expect(isCursorUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/144.0.0.0')).toBe(false)
  })
})
