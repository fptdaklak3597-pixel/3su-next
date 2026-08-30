/**
 * Firebase — chỉ Auth (+ FCM token ở Plan 3). Không dùng Firestore/RTDB trên hot path.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  reload,
  getRedirectResult,
  signInWithCredential,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type ActionCodeSettings,
  type Auth,
  type User,
} from 'firebase/auth'
import {
  classifyCloudUser,
  cloudAuthMessage,
  isCloudEmailPending,
  sendEmailSignInLinkRequest,
  type CloudGate,
} from './cloudAuth'
import { firebaseOptions, googleSignInMode, isCursorUserAgent, isFirebaseConfigured } from './firebaseConfig'

export { firebaseOptions, isFirebaseConfigured }
export {
  CLOUD_MAIL_FROM,
  classifyCloudUser,
  cloudAuthMessage,
  cloudMailHint,
  isCloudEmailPending,
  sendEmailSignInLinkRequest,
} from './cloudAuth'

let app: FirebaseApp | null = null
let auth: Auth | null = null

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) return null
  if (app) return app
  const opts = firebaseOptions()
  if (!opts) return null
  app = getApps()[0] ?? initializeApp(opts)
  return app
}

export function getFirebaseAuth(): Auth | null {
  const a = getFirebaseApp()
  if (!a) return null
  if (auth) return auth
  // getAuth đã gắn indexedDB + local + redirect resolver.
  // Không gọi setPersistence sau đó — sẽ đua và nuốt getRedirectResult.
  auth = getAuth(a)
  return auth
}

export function watchCloudUser(fn: (u: User | null) => void): () => void {
  const a = getFirebaseAuth()
  if (!a) { fn(null); return () => {} }
  return onAuthStateChanged(a, fn)
}

/** IndexedDB Firebase hỏng thì authStateReady() treo — splash không được kẹt. */
async function authStateReadyOrTimeout(a: Auth, ms = 8000): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('auth-ready-timeout')), ms)
      a.authStateReady().then(
        () => { clearTimeout(t); resolve() },
        (e) => { clearTimeout(t); reject(e) },
      )
    })
  } catch {
    /* tiếp tục với currentUser hiện có */
  }
}

/** Chờ Firebase khôi phục session (boot connectCloud). */
export async function waitCloudUser(): Promise<User | null> {
  const a = getFirebaseAuth()
  if (!a) return null
  try { await completePendingSignIn() } catch { /* thiếu email trên máy khác */ }
  if (a.currentUser) return a.currentUser
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(a, (u) => {
      unsub()
      resolve(u)
    })
  })
}

type GateFn = (s: CloudGate) => void
const sessionExtras = new Set<GateFn>()

/** onAuthStateChanged + reload() (reload không luôn bắn auth listener). */
export function watchCloudSession(fn: GateFn): () => void {
  sessionExtras.add(fn)
  const unsub = watchCloudUser((u) => fn(classifyCloudUser(u)))
  return () => {
    sessionExtras.delete(fn)
    unsub()
  }
}

export function pushCloudSession(): void {
  const s = classifyCloudUser(getFirebaseAuth()?.currentUser ?? null)
  sessionExtras.forEach((fn) => fn(s))
}

export async function refreshCloudUser(opts?: { silent?: boolean }): Promise<User | null> {
  const a = getFirebaseAuth()
  const u = a?.currentUser
  if (u) await reload(u)
  const next = a?.currentUser ?? null
  if (!opts?.silent) pushCloudSession()
  return next
}

const EMAIL_KEY = '3su:emailForSignIn'
const PAIR_KEY = '3su:pairForSignIn'
const AUTH_ERR_KEY = '3su:authErr'
const GOOGLE_REDIRECT_KEY = '3su:googleRedirect'
const GIS_ID_KEY = '3su:gisId'

export function takeAuthError(): string {
  if (typeof sessionStorage === 'undefined') return ''
  const v = sessionStorage.getItem(AUTH_ERR_KEY) || ''
  sessionStorage.removeItem(AUTH_ERR_KEY)
  return v
}

function rememberAuthError(e: unknown): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(AUTH_ERR_KEY, cloudAuthMessage(e))
}

export function isGoogleRedirectPending(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(GOOGLE_REDIRECT_KEY) === '1'
}

function clearGoogleRedirectPending(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(GOOGLE_REDIRECT_KEY)
}

export function hasPendingRedirect(): boolean {
  if (isGoogleRedirectPending()) return true
  if (typeof sessionStorage === 'undefined') return false
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i) || ''
    if (k.includes('pendingRedirect') || k.includes('redirectUser')) return true
  }
  return false
}

function actionCodeSettings(): ActionCodeSettings {
  const url = typeof window !== 'undefined' ? `${window.location.origin}/` : 'https://3su.shop/'
  return { url, handleCodeInApp: true }
}

export function peekEmailForSignIn(): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(EMAIL_KEY) || ''
}

export function clearEmailForSignIn(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(EMAIL_KEY)
}

export function setPendingPair(code: string): void {
  if (typeof sessionStorage === 'undefined') return
  const v = code.trim().toUpperCase()
  if (v) sessionStorage.setItem(PAIR_KEY, v)
  else sessionStorage.removeItem(PAIR_KEY)
}

export function takePendingPair(): string {
  if (typeof sessionStorage === 'undefined') return ''
  const v = sessionStorage.getItem(PAIR_KEY) || ''
  sessionStorage.removeItem(PAIR_KEY)
  return v
}

export function isEmailLinkInUrl(): boolean {
  const a = getFirebaseAuth()
  return !!a && typeof window !== 'undefined' && isSignInWithEmailLink(a, window.location.href)
}

export async function cloudSendEmailLink(email: string): Promise<void> {
  const opts = firebaseOptions()
  if (!opts?.apiKey) throw new Error('Chưa cấu hình Firebase')
  const clean = email.trim()
  await sendEmailSignInLinkRequest({
    apiKey: opts.apiKey,
    email: clean,
    continueUrl: actionCodeSettings().url,
  })
  localStorage.setItem(EMAIL_KEY, clean)
}

/** Một lần / trang — getRedirectResult chỉ đọc được một lần. */
let pendingSignIn: Promise<User | null> | null = null

/** Google redirect + liên kết email — gọi khi boot. */
export async function completePendingSignIn(emailOverride?: string): Promise<User | null> {
  if (emailOverride) return doCompletePendingSignIn(emailOverride)
  if (!pendingSignIn) {
    pendingSignIn = doCompletePendingSignIn().finally(() => {
      clearGoogleRedirectPending()
    })
  }
  return pendingSignIn
}

async function doCompletePendingSignIn(emailOverride?: string): Promise<User | null> {
  const a = getFirebaseAuth()
  if (!a || typeof window === 'undefined') return null
  await authStateReadyOrTimeout(a)
  const gisId = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(GIS_ID_KEY) : ''
  if (gisId) {
    sessionStorage.removeItem(GIS_ID_KEY)
    try {
      const cred = GoogleAuthProvider.credential(gisId)
      const result = await signInWithCredential(a, cred)
      pushCloudSession()
      return result.user
    } catch (e) {
      rememberAuthError(e)
    }
  }
  // Liên kết email trước — đừng để getRedirectResult chặn URL có oobCode.
  if (isSignInWithEmailLink(a, window.location.href)) {
    try {
      const fromLink = await completeEmailLinkSignIn(emailOverride)
      if (fromLink) return fromLink
    } catch (e) {
      if (emailOverride) throw e
      rememberAuthError(e)
    }
  }
  if (hasPendingRedirect()) {
    const userStarted = isGoogleRedirectPending()
    try {
      const redirect = await getRedirectResult(a)
      if (redirect?.user) return redirect.user
    } catch (e) {
      // State Firebase sót từ lần iframe bị chặn — đừng biến mọi lần F5 thành lỗi đỏ.
      if (userStarted) rememberAuthError(e)
    }
  }
  return a.currentUser
}

export async function completeEmailLinkSignIn(emailOverride?: string): Promise<User | null> {
  const a = getFirebaseAuth()
  if (!a || typeof window === 'undefined') return null
  if (!isSignInWithEmailLink(a, window.location.href)) return null
  const email = (emailOverride || peekEmailForSignIn()).trim()
  if (!email) {
    const err = new Error('Nhập lại email để hoàn tất') as Error & { code: string }
    err.code = 'auth/missing-email'
    throw err
  }
  const cred = await signInWithEmailLink(a, email, window.location.href)
  clearEmailForSignIn()
  const url = new URL(window.location.href)
  window.history.replaceState({}, '', url.pathname)
  return cred.user
}

function googleProvider(): GoogleAuthProvider {
  const p = new GoogleAuthProvider()
  p.setCustomParameters({ prompt: 'select_account' })
  return p
}

function googleWebClientId(): string {
  return (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || '').trim()
}

type GisId = {
  initialize: (cfg: {
    client_id: string
    callback?: (r: { credential?: string }) => void
    ux_mode?: 'popup' | 'redirect'
    login_uri?: string
    use_fedcm_for_prompt?: boolean
    itp_support?: boolean
  }) => void
  prompt: (cb?: (n: {
    isNotDisplayed: () => boolean
    isSkippedMoment: () => boolean
    isDismissedMoment: () => boolean
  }) => void) => void
  renderButton: (el: HTMLElement, opts: Record<string, string>) => void
}

function gisId(): GisId | null {
  const g = (window as unknown as { google?: { accounts?: { id?: GisId } } }).google
  return g?.accounts?.id ?? null
}

let gisScript: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (gisId()) return Promise.resolve()
  if (!gisScript) {
    gisScript = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Không tải được Google'))
      document.head.appendChild(s)
    })
  }
  return gisScript
}

function gisLoginUri(): string {
  return `${window.location.origin}/__/gis`
}

async function signInWithGisIdToken(auth: Auth, jwt: string): Promise<User> {
  const cred = GoogleAuthProvider.credential(jwt)
  const result = await signInWithCredential(auth, cred)
  pushCloudSession()
  return result.user
}

/** One Tap / FedCM — không mở tab. Electron thường bỏ qua → null. */
function tryGisPrompt(auth: Auth, id: GisId, clientId: string): Promise<User | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (u: User | null) => {
      if (done) return
      done = true
      resolve(u)
    }
    window.setTimeout(() => finish(null), 2500)
    id.initialize({
      client_id: clientId,
      callback: (r) => {
        if (!r.credential) { finish(null); return }
        void signInWithGisIdToken(auth, r.credential).then(finish).catch(() => finish(null))
      },
      use_fedcm_for_prompt: true,
      itp_support: true,
    })
    id.prompt((n) => {
      if (n.isNotDisplayed() || n.isSkippedMoment() || n.isDismissedMoment()) finish(null)
    })
  })
}

/** Cùng tab: Google → POST /__/gis → về app. Cursor không giữ được popup. */
function beginGisRedirect(id: GisId, clientId: string): void {
  id.initialize({
    client_id: clientId,
    ux_mode: 'redirect',
    login_uri: gisLoginUri(),
    callback: () => { /* redirect không gọi callback */ },
  })
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.appendChild(host)
  id.renderButton(host, { type: 'standard', theme: 'outline', size: 'large', ux_mode: 'redirect' })
  window.setTimeout(() => {
    const btn = host.querySelector<HTMLElement>('[role="button"], iframe, div[tabindex]')
    btn?.click()
  }, 50)
}

/** Cursor: FedCM rồi redirect cùng origin — không dùng popup token. */
async function signInGoogleGis(auth: Auth): Promise<User | null> {
  const clientId = googleWebClientId()
  if (!clientId) throw new Error('Chưa cấu hình Google. Mở Chrome để đăng nhập.')
  await loadGis()
  const id = gisId()
  if (!id) throw new Error('Không tải được Google')
  const fromPrompt = await tryGisPrompt(auth, id, clientId)
  if (fromPrompt) return fromPrompt
  beginGisRedirect(id, clientId)
  return null
}

/** Cursor/Electron — không probe window.open (sẽ nuốt tab). */
export function isEmbeddedAuthBrowser(): boolean {
  if (typeof navigator !== 'undefined' && isCursorUserAgent(navigator.userAgent)) return true
  if (typeof window === 'undefined') return true
  try { if (window.self !== window.top) return true } catch { return true }
  return false
}

async function redirectGoogle(auth: Auth): Promise<null> {
  if (typeof localStorage !== 'undefined') localStorage.setItem(GOOGLE_REDIRECT_KEY, '1')
  await signInWithRedirect(auth, googleProvider())
  return null
}

/** Chrome: popup. pages.dev + webview: redirect cùng origin. localhost + webview: GIS. */
export async function cloudSignInGoogle(): Promise<User | null> {
  const a = getFirebaseAuth()
  if (!a) throw new Error('Chưa cấu hình Firebase')
  await authStateReadyOrTimeout(a)
  const opts = firebaseOptions()
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const mode = googleSignInMode(opts?.authDomain || '', host, isEmbeddedAuthBrowser())
  if (mode === 'gis') return signInGoogleGis(a)
  if (mode === 'redirect') return redirectGoogle(a)
  try {
    const cred = await signInWithPopup(a, googleProvider())
    pushCloudSession()
    return cred.user
  } catch (e) {
    const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : ''
    if (code !== 'auth/popup-blocked') throw e
    const fallback = googleSignInMode(opts?.authDomain || '', host, true)
    if (fallback === 'redirect') return redirectGoogle(a)
    return signInGoogleGis(a)
  }
}

export async function cloudSignOut(): Promise<void> {
  const a = getFirebaseAuth()
  if (a) await signOut(a)
}

export async function getCloudIdToken(): Promise<string> {
  const a = getFirebaseAuth()
  const u = a?.currentUser
  if (!u) throw new Error('Chưa đăng nhập cloud')
  if (isCloudEmailPending(u)) throw new Error('Chưa xác nhận email')
  return u.getIdToken()
}
