/**
 * 3SU Next — Mobile App (PWA bán hàng)
 * Root component: boot DB, sync, theme, routing.
 */
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '@/core/store'
import { dbx, getSettings, getShop, getCurrentUser, getTrial } from '@/core/db'
import { onSyncState, startSyncLoop } from '@/core/sync/engine'
import { useOnline, useServiceWorkerUpdate } from '@/shared/pwa'
import { ToastHost, CelebrationHost, OfflineBar, UpdateBanner } from '@/shared/components'
import { MobileShell } from './layout/MobileShell'
import { HomePage } from './pages/HomePage'
import { SalePage } from './pages/SalePage'
import { CheckoutPage } from './pages/CheckoutPage'
import { OrdersPage } from './pages/OrdersPage'
import { OrderDetailPage } from './pages/OrderDetailPage'
import { InventoryPage } from './pages/InventoryPage'
import { ProductDetailPage } from './pages/ProductDetailPage'
import { CustomersPage } from './pages/CustomersPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { GoodsReceiptPage } from './pages/GoodsReceiptPage'
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage'
import { StocktakePage } from './pages/StocktakePage'
import { SuppliersPage } from './pages/SuppliersPage'
import { UsersPage } from './pages/UsersPage'
import { DevicesPage } from './pages/DevicesPage'
import { InvoicesPage } from './pages/InvoicesPage'
import { ToolsPage } from './pages/ToolsPage'
import { MorePage } from './pages/MorePage'
import { LoginPage } from './pages/LoginPage'
import { useCloudSession } from '@/shared/useCloudSession'
import { AuthBootSplash, CloudAuthScreen, CloudShopJoinScreen } from '@/shared/CloudAuthScreen'
import { ShopLicenseScreen, useShopLicense } from '@/shared/ShopLicenseGate'
import { isLicenseBlocked } from '@/core/sync/license'
import { useShopUsageTracker } from '@/core/sync/usageTracker'

export function MobileApp() {
  const setReady = useApp((s) => s.setReady)
  const setSettings = useApp((s) => s.setSettings)
  const setShop = useApp((s) => s.setShop)
  const setUser = useApp((s) => s.setUser)
  const user = useApp((s) => s.user)
  const ready = useApp((s) => s.ready)
  const setTrial = useApp((s) => s.setTrial)
  const setSync = useApp((s) => s.setSync)
  const setOnline = useApp((s) => s.setOnline)
  const setTheme = useApp((s) => s.setTheme)
  const largeText = useApp((s) => s.settings.largeText)
  const online = useOnline()
  const { updateReady, applyUpdate } = useServiceWorkerUpdate()

  // Chữ lớn: áp cho toàn app, đổi ngay khi bật/tắt trong Cài đặt
  useEffect(() => {
    document.documentElement.toggleAttribute('data-font-large', largeText === true)
  }, [largeText])

  // Boot: nạp settings/shop/user từ IndexedDB
  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const [settings, shop, user, trial] = await Promise.all([
          getSettings(), getShop(), getCurrentUser(), getTrial(),
        ])
        if (cancelled) return
        setSettings(settings)
        setShop(shop)
        setUser(user)
        setTrial(trial)
        setTheme(settings.theme)
      } catch (e) {
        console.error('Boot failed', e)
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    boot()
    return () => { cancelled = true }
  }, [setReady, setSettings, setShop, setUser, setTrial, setTheme])

  const liveSettingsRow = useLiveQuery(() => dbx.meta.get('settings'), [])
  const liveShopRow = useLiveQuery(() => dbx.meta.get('shop'), [])
  useEffect(() => {
    if (liveSettingsRow?.value && typeof liveSettingsRow.value === 'object') {
      setSettings(liveSettingsRow.value as import('@/core/types').Settings)
    }
  }, [liveSettingsRow, setSettings])
  useEffect(() => {
    if (liveShopRow?.value && typeof liveShopRow.value === 'object') {
      setShop(liveShopRow.value as import('@/core/types').ShopInfo)
    }
  }, [liveShopRow, setShop])

  // Sync: theo dõi trạng thái (engine v2 khởi động ở main.tsx)
  useEffect(() => {
    startSyncLoop()
    const unsub = onSyncState(setSync)
    return unsub
  }, [setSync])

  // Online status → store
  useEffect(() => { setOnline(online) }, [online, setOnline])

  const cloud = useCloudSession()
  const usersCount = useLiveQuery(() => dbx.users.filter((u) => !u.deleted).count(), [], 0)
  // Dev-only: ?preview=1 bỏ qua cổng cloud để soi UI local (không dùng production).
  const uiPreview = import.meta.env.DEV && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('preview') === '1'
  const needsStaff = ready && usersCount > 0 && !user && !uiPreview
  const needsCloud = cloud === 'out' && !uiPreview
  const needsShop = cloud === 'need-shop' && !uiPreview
  const licenseOn = cloud === 'in' && !uiPreview
  const license = useShopLicense(licenseOn)
  const needsLicense = licenseOn && license.ready && isLicenseBlocked(license.value)
  useShopUsageTracker(licenseOn && !needsLicense)
  const booting = !ready || (!uiPreview && cloud === 'loading') || (licenseOn && !license.ready)

  return (
    <BrowserRouter>
      <div className="app-shell">
        <OfflineBar />
        <UpdateBanner ready={updateReady} onApply={applyUpdate} />
        {booting ? (
          <AuthBootSplash />
        ) : needsCloud ? (
          <CloudAuthScreen />
        ) : needsShop ? (
          <CloudShopJoinScreen />
        ) : needsLicense && license.value ? (
          <ShopLicenseScreen license={license.value} />
        ) : needsStaff ? (
          <LoginPage />
        ) : (
        <Routes>
          <Route element={<MobileShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/ban-hang" element={<SalePage />} />
            <Route path="/thanh-toan" element={<CheckoutPage />} />
            <Route path="/don-hang" element={<OrdersPage />} />
            <Route path="/don-hang/:id" element={<OrderDetailPage />} />
            <Route path="/kho" element={<InventoryPage />} />
            <Route path="/kho/:id" element={<ProductDetailPage />} />
            <Route path="/nhap-hang" element={<GoodsReceiptPage />} />
            <Route path="/don-mua" element={<PurchaseOrdersPage />} />
            <Route path="/kiem-ke" element={<StocktakePage />} />
            <Route path="/khach-hang" element={<CustomersPage />} />
            <Route path="/bao-cao" element={<ReportsPage />} />
            <Route path="/cai-dat" element={<SettingsPage />} />
            <Route path="/them" element={<MorePage />} />
            <Route path="/nha-cung-cap" element={<SuppliersPage />} />
            <Route path="/nguoi-dung" element={<UsersPage />} />
            {/* Route cũ → core */}
            <Route path="/thiet-bi" element={<DevicesPage />} />
            <Route path="/nhap-hang/hoa-don" element={<Navigate to="/nhap-hang" replace />} />
            <Route path="/hoa-don" element={<InvoicesPage />} />
            <Route path="/cong-cu" element={<ToolsPage />} />
            <Route path="/chuyen-tu-3su-cu" element={<Navigate to="/cai-dat" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        )}
        <ToastHost />
        <CelebrationHost />
      </div>
    </BrowserRouter>
  )
}
