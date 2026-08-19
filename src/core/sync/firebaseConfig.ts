/**
 * 3SU Next — Cấu hình Firebase (chỉ đọc env, KHÔNG import SDK)
 * Module nhẹ để UI kiểm tra nhanh trạng thái cấu hình mà không kéo
 * toàn bộ Firebase SDK vào bundle chính.
 */
import type { FirebaseOptions } from 'firebase/app'

const clean = (value: string | undefined): string => value?.trim() ?? ''

const FALLBACK_AUTH_DOMAIN = 'su-next.firebaseapp.com'

/** Cùng origin với app — tránh mất storage bên thứ ba khi Google redirect (webview chặn).
 * LƯU Ý: SDK luôn ép https:// cho handler nên chỉ khả dụng trên host https có proxy /__/auth
 * (vd Cloudflare Pages với rule rewrite). Localhost http chưa dùng được. */
const SAME_ORIGIN_AUTH_HOSTS = new Set([
  'su-next-web.pages.dev',
  'su-next-app.pages.dev',
  '3su.shop',
  'www.3su.shop',
  'app.3su.shop',
  'admin.3su.shop',
])

export function resolveAuthDomain(envDomain: string, host: string): string {
  if (SAME_ORIGIN_AUTH_HOSTS.has(host)) return host
  return envDomain || FALLBACK_AUTH_DOMAIN
}

export type GoogleSignInMode = 'popup' | 'redirect' | 'gis'

export function isCursorUserAgent(ua: string): boolean {
  return /Electron|Cursor/i.test(ua)
}

/** Webview (Cursor) nuốt popup thành tab → đừng redirect sang firebaseapp.com (mất state). */
export function googleSignInMode(authDomain: string, hostname: string, embedded: boolean): GoogleSignInMode {
  if (!embedded) return 'popup'
  return authDomain === hostname ? 'redirect' : 'gis'
}

/** Trả về null nếu thiếu cấu hình (thay vì ném lỗi) — cho phép chạy offline. */
export function firebaseOptions(hostname?: string): FirebaseOptions | null {
  const envDomain = clean(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN)
  const host = hostname
    ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  const options: FirebaseOptions = {
    apiKey: clean(import.meta.env.VITE_FIREBASE_API_KEY),
    authDomain: resolveAuthDomain(envDomain, host),
    projectId: clean(import.meta.env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: clean(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET) || undefined,
    messagingSenderId: clean(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID) || undefined,
    appId: clean(import.meta.env.VITE_FIREBASE_APP_ID),
  }
  if (!options.apiKey || !options.projectId || !options.appId) return null
  return options
}

export function isFirebaseConfigured(): boolean {
  return firebaseOptions() !== null
}
