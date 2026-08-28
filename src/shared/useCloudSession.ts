/**
 * Phiên Firebase — một bộ nhớ chung cho web + form đăng nhập.
 * Không chờ tạo shop xong mới lắng nghe auth (tránh kẹt màn hình cũ).
 * Sau Google/email: xác minh membership server trước khi mở dữ liệu local.
 */
import { useEffect, useState } from 'react'
import { shopGateFromEnterResult } from '@/core/domain/health-banners'
import {
  classifyCloudUser,
  completePendingSignIn,
  getFirebaseAuth,
  isFirebaseConfigured,
  isGoogleRedirectPending,
  watchCloudSession,
} from '@/core/sync/firebase'

export type CloudSession = 'loading' | 'in' | 'out' | 'verify' | 'need-shop'

let started = false
let current: CloudSession = 'loading'
let generation = 0
const listeners = new Set<(s: CloudSession) => void>()

function gateOfUser(): CloudSession {
  const raw = classifyCloudUser(getFirebaseAuth()?.currentUser ?? null)
  return raw
}

function emit(s: CloudSession): void {
  current = s
  listeners.forEach((fn) => fn(s))
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

async function resolveShopGate(): Promise<CloudSession> {
  const { enterExistingCloudShop } = await import('@/core/sync/cloud')
  const { getMeta } = await import('@/core/db')
  const localShopId = await getMeta<string | null>('cloud:shopId', null)
  try {
    const id = await withTimeout(enterExistingCloudShop(), 8000)
    return shopGateFromEnterResult({ enteredId: id, localShopId, enterFailed: false })
  } catch {
    return shopGateFromEnterResult({ enteredId: null, localShopId, enterFailed: true })
  }
}

function startCloudSession(): void {
  if (started) return
  started = true
  if (!isFirebaseConfigured()) {
    emit('out')
    return
  }

  if (isGoogleRedirectPending()) emit('loading')

  watchCloudSession((s) => {
    const run = ++generation
    if (s === 'out' && isGoogleRedirectPending()) return
    if (s === 'out') {
      void import('@/core/sync/cloud')
        .then((m) => m.clearCloudSession())
        .catch(() => {})
        .finally(() => { if (run === generation) emit('out') })
      return
    }
    if (s === 'verify') {
      if (run === generation) emit('verify')
      return
    }
    emit('loading')
    void resolveShopGate().then((next) => {
      if (run === generation) emit(next)
    })
  })

  void (async () => {
    try {
      const u = await completePendingSignIn()
      if (u) {
        const run = ++generation
        const next = await resolveShopGate()
        if (run === generation) emit(next)
        return
      }
    } catch { /* thiếu email trên máy khác — form hỏi lại */ }
    if (current === 'loading') emit(gateOfUser())
  })()
}

/** Gọi sau khi chọn, tạo cửa hàng hoặc nhập mã thành công. */
export function markCloudShopEntered(): void {
  emit('in')
}

export function markCloudNeedShop(): void {
  emit('need-shop')
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    started = false
    current = 'loading'
    generation = 0
    listeners.clear()
  })
}

export function useCloudSession(): CloudSession {
  const [state, setState] = useState<CloudSession>(current)

  useEffect(() => {
    startCloudSession()
    listeners.add(setState)
    setState(current)
    return () => { listeners.delete(setState) }
  }, [])

  return state
}
