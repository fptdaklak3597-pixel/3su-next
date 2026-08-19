import { useEffect, useState } from 'react'
import { cloudSignOut } from '@/core/sync/firebase'
import {
  loadCachedLicense,
  watchLicense,
  type ShopLicense,
} from '@/core/sync/license'

export function useShopLicense(enabled: boolean): { ready: boolean; value: ShopLicense | null } {
  const [value, setValue] = useState<ShopLicense | null>(null)
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setFetched(false)
      return
    }
    let cancelled = false
    setFetched(false)
    void (async () => {
      const cached = await loadCachedLicense()
      if (!cancelled) {
        setValue(cached)
        setFetched(true)
      }
      try {
        const { refreshShopLicense } = await import('@/core/sync/cloud')
        const fresh = await refreshShopLicense()
        if (!cancelled) setValue(fresh)
      } catch {
        /* offline: giữ cache */
      }
    })()
    const unsub = watchLicense((lic) => {
      if (!cancelled) setValue(lic)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [enabled])

  return { ready: !enabled || fetched, value }
}

export function ShopLicenseScreen({ license }: { license: ShopLicense }) {
  const locked = license.status === 'locked'
  return (
    <div className="auth-screen">
      <div className="auth-logo">3SU</div>
      <div className="auth-layout">
        <div className="auth-col">
          <h1 className="auth-display">
            {locked ? 'Cửa hàng đã tạm khoá' : 'Cửa hàng đã hết hạn'}
          </h1>
          <div className="auth-well">
            <p className="auth-lead">
              {locked
                ? (license.reason || 'Vui lòng liên hệ để gia hạn hoặc mở khoá.')
                : 'Vui lòng liên hệ để gia hạn.'}
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
