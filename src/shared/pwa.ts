/**
 * 3SU Next — PWA hooks
 * Install prompt, online status, service worker auto-update.
 */
import { useState, useEffect, useCallback, useRef } from 'react'

/* ─── Online status ─── */
export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/* ─── Install prompt ─── */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const installedHandler = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', installedHandler)

    // Đã cài rồi?
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferred) return false
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    setDeferred(null)
    return outcome === 'accepted'
  }, [deferred])

  return { canInstall: !!deferred, installed, promptInstall }
}

/* ─── Service Worker updates ─── */
const SW_CHECK_MS = 60 * 60 * 1000

function activateWaiting(worker: ServiceWorker | null | undefined): void {
  if (!worker) return
  worker.postMessage({ type: 'SKIP_WAITING' })
}

export function useServiceWorkerUpdate(): {
  updateAvailable: boolean
  applyUpdate: () => void
} {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const waitingWorker = useRef<ServiceWorker | null>(null)
  const applying = useRef(false)

  const applyUpdate = useCallback(() => {
    if (!waitingWorker.current) return
    applying.current = true
    activateWaiting(waitingWorker.current)
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let cancelled = false
    let refreshing = false
    let checkTimer: ReturnType<typeof setInterval> | null = null
    let check: (() => void) | null = null
    let onVisible: (() => void) | null = null
    let registration: ServiceWorkerRegistration | null = null
    let onUpdateFound: (() => void) | null = null
    let installingWorker: ServiceWorker | null = null
    let onStateChange: (() => void) | null = null

    const reloadOnce = () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    }

    const onControllerChange = () => {
      if (applying.current) reloadOnce()
    }

    void navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (cancelled) return
        registration = reg
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

        const markAvailable = (worker: ServiceWorker) => {
          waitingWorker.current = worker
          setUpdateAvailable(true)
        }

        if (reg.waiting) {
          if (navigator.serviceWorker.controller) markAvailable(reg.waiting)
          else activateWaiting(reg.waiting)
        }

        onUpdateFound = () => {
          const next = reg.installing
          if (!next) return
          if (installingWorker && onStateChange) {
            installingWorker.removeEventListener('statechange', onStateChange)
          }
          installingWorker = next
          onStateChange = () => {
            if (next.state !== 'installed') return
            const worker = reg.waiting ?? next
            if (navigator.serviceWorker.controller) markAvailable(worker)
            else activateWaiting(worker)
          }
          next.addEventListener('statechange', onStateChange)
        }
        reg.addEventListener('updatefound', onUpdateFound)

        check = () => { void reg.update() }
        onVisible = () => {
          if (document.visibilityState === 'visible') check?.()
        }
        checkTimer = setInterval(check, SW_CHECK_MS)
        window.addEventListener('focus', check)
        document.addEventListener('visibilitychange', onVisible)
      })
      .catch(() => { /* SW lỗi — app vẫn chạy online */ })

    return () => {
      cancelled = true
      if (checkTimer) clearInterval(checkTimer)
      if (check) window.removeEventListener('focus', check)
      if (onVisible) document.removeEventListener('visibilitychange', onVisible)
      if (registration && onUpdateFound) registration.removeEventListener('updatefound', onUpdateFound)
      if (installingWorker && onStateChange) {
        installingWorker.removeEventListener('statechange', onStateChange)
      }
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  return { updateAvailable, applyUpdate }
}

/* ─── Display mode ─── */
export function useDisplayMode(): 'standalone' | 'browser' {
  const [mode, setMode] = useState<'standalone' | 'browser'>(
    window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
  )
  useEffect(() => {
    const mql = window.matchMedia('(display-mode: standalone)')
    const handler = (e: MediaQueryListEvent) => setMode(e.matches ? 'standalone' : 'browser')
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return mode
}
