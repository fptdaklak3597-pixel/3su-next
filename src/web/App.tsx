/**
 * 3SU Next — Web App
 * Khung KiotViet (thanh trên, POS fullscreen, bảng).
 * Trang web-native; POS thanh toán vẫn dùng checkout chung.
 */
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '@/core/store'
import { dbx, getSettings, getShop, getCurrentUser, getTrial } from '@/core/db'
import { onSyncState, startSyncLoop } from '@/core/sync/engine'
import { useOnline, useServiceWorkerUpdate } from '@/shared/pwa'
import { ToastHost, CelebrationHost, OfflineBar, UpdateBanner } from '@/shared/components'
import { WebShell } from './layout/WebShell'
import { WebHomePage } from './pages/HomePage'
import { WebSalePage } from './pages/SalePage'
import { WebInventoryPage } from './pages/InventoryPage'
import { WebCustomersPage } from './pages/CustomersPage'
import { WebOrdersPage } from './pages/OrdersPage'
import { WebOrderDetailPage } from './pages/OrderDetailPage'
import { WebProductDetailPage } from './pages/ProductDetailPage'
import { WebReportsPage } from './pages/ReportsPage'
import { WebSettingsPage } from './pages/SettingsPage'
import { WebGoodsReceiptPage } from './pages/GoodsReceiptPage'
import { WebPurchaseOrdersPage } from './pages/PurchaseOrdersPage'
import { WebStocktakePage } from './pages/StocktakePage'
import { WebSuppliersPage } from './pages/SuppliersPage'
import { WebDevicesPage } from './pages/DevicesPage'
import { WebInvoicesPage } from './pages/InvoicesPage'
import { WebToolsPage } from './pages/ToolsPage'
import { WebUsersPage } from './pages/UsersPage'
import { WebPrintAgentPage } from './pages/PrintAgentPage'
import { WebAccountPage } from './pages/AccountPage'
import { WebNotesPage } from './pages/NotesPage'
import { LoginPage } from '@/mobile/pages/LoginPage'
import { useCloudSession } from '@/shared/useCloudSession'
import { AuthBootSplash, CloudAuthScreen, CloudShopJoinScreen } from '@/shared/CloudAuthScreen'
import { ShopLicenseScreen, useShopLicense } from '@/shared/ShopLicenseGate'
import { isLicenseBlocked } from '@/core/sync/license'
import { useShopUsageTracker } from '@/core/sync/usageTracker'

export function WebApp() {
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
        // Web UI chuẩn light theo mockup; dark chỉ khi user chủ động chọn sau migration.
        setTheme(settings.theme === 'dark' ? 'light' : settings.theme)
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

  useEffect(() => {
    startSyncLoop()
    const unsub = onSyncState(setSync)
    return unsub
  }, [setSync])

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
          <Route path="/may-in" element={<WebPrintAgentPage />} />
            <Route element={<WebShell />}>
              <Route path="/" element={<WebHomePage />} />
              <Route path="/ban-hang" element={<WebSalePage />} />
              <Route path="/thanh-toan" element={<Navigate to="/ban-hang" replace />} />
              <Route path="/don-hang" element={<WebOrdersPage />} />
              <Route path="/don-hang/:id" element={<WebOrderDetailPage />} />
              <Route path="/kho" element={<WebInventoryPage />} />
              <Route path="/kho/:id" element={<WebProductDetailPage />} />
              <Route path="/nhap-hang" element={<WebGoodsReceiptPage />} />
              <Route path="/don-mua" element={<WebPurchaseOrdersPage />} />
              <Route path="/kiem-ke" element={<WebStocktakePage />} />
              <Route path="/khach-hang" element={<WebCustomersPage />} />
              <Route path="/nha-cung-cap" element={<WebSuppliersPage />} />
              <Route path="/bao-cao" element={<WebReportsPage />} />
              <Route path="/cai-dat" element={<WebSettingsPage />} />
              <Route path="/tai-khoan" element={<WebAccountPage />} />
              <Route path="/thiet-bi" element={<WebDevicesPage />} />
              <Route path="/nguoi-dung" element={<WebUsersPage />} />
              <Route path="/ghi-chu" element={<WebNotesPage />} />
              {/* Route cũ → chuyển về luồng core, không còn menu riêng */}
              <Route path="/nhap-hang/hoa-don" element={<Navigate to="/nhap-hang" replace />} />
              <Route path="/hoa-don" element={<WebInvoicesPage />} />
              <Route path="/cong-cu" element={<WebToolsPage />} />
              <Route path="/doi-soat" element={<Navigate to="/cai-dat" replace />} />
              <Route path="/chuyen-tu-3su-cu" element={<Navigate to="/cai-dat" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
        </Routes>
        )}
        <ToastHost />
        <CelebrationHost />
      </div>
    </BrowserRouter>
  )
}
