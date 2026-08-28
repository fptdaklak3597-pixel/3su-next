import { useEffect, useState } from 'react'
import { cloudSignOut } from '@/core/sync/firebase'
import {
  loadCachedLicense,
  watchLicense,
  type ShopLicense,
} from '@/core/sync/license'

export function useShopLicense(enabled: boolean): { ready: boolean; value: ShopLicense | null } {
  const [gate, setGate] = useState({ enabled: false, fetched: false, value: null as ShopLicense | null })
  if (enabled !== gate.enabled) {
    setGate({ enabled, fetched: false, value: null })
  }

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      const cached = await loadCachedLicense()
      if (!cancelled && cached) {
        setGate((g) => (g.enabled === enabled ? { ...g, fetched: true, value: cached } : g))
      }
      try {
        const { refreshShopLicense } = await import('@/core/sync/cloud')
        const fresh = await refreshShopLicense()
        if (!cancelled) setGate((g) => (g.enabled === enabled ? { ...g, fetched: true, value: fresh } : g))
      } catch {
        if (!cancelled) {
          setGate((g) => (g.enabled === enabled ? { ...g, fetched: true, value: g.value ?? cached } : g))
        }
      }
    })()
    const unsub = watchLicense((lic) => {
      if (!cancelled) setGate((g) => (g.enabled === enabled ? { ...g, value: lic } : g))
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [enabled])

  return { ready: !enabled || gate.fetched, value: gate.value }
}

export function ShopLicenseScreen({ license }: { license: ShopLicense | null }) {
  const title = !license
    ? 'Chưa xác nhận giấy phép'
    : license.status === 'locked'
      ? 'Cửa hàng đã tạm khoá'
      : 'Cửa hàng đã hết hạn'
  const lead = !license
    ? 'Kết nối mạng để kiểm tra giấy phép, hoặc đăng xuất.'
    : license.status === 'locked'
      ? (license.reason || 'Vui lòng liên hệ để gia hạn hoặc mở khoá.')
      : 'Vui lòng liên hệ để gia hạn.'
  return (
    <div className="auth-screen">
      <div className="auth-logo">3SU</div>
      <div className="auth-layout">
        <div className="auth-col">
          <h1 className="auth-display">
            {title}
          </h1>
          <div className="auth-well">
            <p className="auth-lead">
              {lead}
            </p>
            <button
              type="button"
              className="auth-btn auth-btn-pri"
              onClick={() => { void cloudSignOut() }}
            >
              Đăng xuất
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
