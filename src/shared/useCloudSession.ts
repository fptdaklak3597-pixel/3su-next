/**
 * Phiên Firebase — một bộ nhớ chung cho web + form đăng nhập.
 * Không chờ tạo shop xong mới lắng nghe auth (tránh kẹt màn hình cũ).
 * Sau Google/email: cùng email chủ thì vào shop có sẵn; không có thì 'need-shop' (nhập mã / tạo mới).
 */
import { useEffect, useState } from 'react'
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
const listeners = new Set<(s: CloudSession) => void>()

function gateOfUser(): CloudSession {
  const raw = classifyCloudUser(getFirebaseAuth()?.currentUser ?? null)
  return raw === 'verify' ? 'in' : raw
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
  const { enterExistingCloudShop, getCloudShopId, isCloudPaused } = await import('@/core/sync/cloud')
  const local = await getCloudShopId()
  if (local) {
    if (!(await isCloudPaused())) void enterExistingCloudShop()
    return 'in'
  }
  try {
    const id = await withTimeout(enterExistingCloudShop(), 8000)
    return id ? 'in' : 'need-shop'
  } catch {
    return 'need-shop'
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
    if (s === 'out' && isGoogleRedirectPending()) return
    if (s === 'out') {
      emit('out')
      return
    }
    if (s === 'verify') {
      emit('in')
      return
    }
    void resolveShopGate().then(emit)
  })

  void (async () => {
    try {
      const u = await completePendingSignIn()
      if (u) {
        emit(await resolveShopGate())
        return
      }
    } catch { /* thiếu email trên máy khác — form hỏi lại */ }
    if (current === 'loading') emit(gateOfUser())
  })()
}

/** Gọi sau khi tạo cửa hàng hoặc nhập mã thành công. */
export function markCloudShopEntered(): void {
  emit('in')
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    started = false
    current = 'loading'
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
