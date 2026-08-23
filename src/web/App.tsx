/**
 * 3SU Next — Web App
 * Khung KiotViet (thanh trên, POS fullscreen, bảng).
 * Trang web-native; POS thanh toán vẫn dùng checkout chung.
 */
import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '@/core/store'
import { dbx, getSettings, getShop, getCurrentUser, getTrial } from '@/core/db'
import { onSyncState, startSyncLoop } from '@/core/sync/engine'
import { useOnline } from '@/shared/pwa'
import { ToastHost, CelebrationHost, OfflineBar, SwUpdateBanner } from '@/shared/components'
import { PermissionRoute } from '@/shared/PermissionRoute'
import { WebShell } from './layout/WebShell'
import { LoginPage } from '@/mobile/pages/LoginPage'
import { useCloudSession } from '@/shared/useCloudSession'
import { AuthBootSplash, CloudAuthScreen, CloudShopJoinScreen } from '@/shared/CloudAuthScreen'
import { ShopLicenseScreen, useShopLicense } from '@/shared/ShopLicenseGate'
import { isLicenseBlocked } from '@/core/sync/license'
import { useShopUsageTracker } from '@/core/sync/usageTracker'

const WebHomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.WebHomePage })))
const WebSalePage = lazy(() => import('./pages/SalePage').then((m) => ({ default: m.WebSalePage })))
const WebInventoryPage = lazy(() => import('./pages/InventoryPage').then((m) => ({ default: m.WebInventoryPage })))
const WebCustomersPage = lazy(() => import('./pages/CustomersPage').then((m) => ({ default: m.WebCustomersPage })))
const WebOrdersPage = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.WebOrdersPage })))
const WebOrderDetailPage = lazy(() => import('./pages/OrderDetailPage').then((m) => ({ default: m.WebOrderDetailPage })))
const WebProductDetailPage = lazy(() => import('./pages/ProductDetailPage').then((m) => ({ default: m.WebProductDetailPage })))
const WebReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.WebReportsPage })))
const WebSettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.WebSettingsPage })))
const WebGoodsReceiptPage = lazy(() => import('./pages/GoodsReceiptPage').then((m) => ({ default: m.WebGoodsReceiptPage })))
const WebPurchaseOrdersPage = lazy(() => import('./pages/PurchaseOrdersPage').then((m) => ({ default: m.WebPurchaseOrdersPage })))
const WebStocktakePage = lazy(() => import('./pages/StocktakePage').then((m) => ({ default: m.WebStocktakePage })))
const WebSuppliersPage = lazy(() => import('./pages/SuppliersPage').then((m) => ({ default: m.WebSuppliersPage })))
const WebDevicesPage = lazy(() => import('./pages/DevicesPage').then((m) => ({ default: m.WebDevicesPage })))
const WebInvoicesPage = lazy(() => import('./pages/InvoicesPage').then((m) => ({ default: m.WebInvoicesPage })))
const WebToolsPage = lazy(() => import('./pages/ToolsPage').then((m) => ({ default: m.WebToolsPage })))
const WebUsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.WebUsersPage })))
const WebPrintAgentPage = lazy(() => import('./pages/PrintAgentPage').then((m) => ({ default: m.WebPrintAgentPage })))
const WebAccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.WebAccountPage })))
const WebNotesPage = lazy(() => import('./pages/NotesPage').then((m) => ({ default: m.WebNotesPage })))

function RouteFallback() {
  return <div className="p-6 text-sm" style={{ color: 'var(--kv-muted, #64748b)' }}>Đang tải…</div>
}

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
  const usersCount = useLiveQuery(() => dbx.users.count(), [], 0)
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
        <SwUpdateBanner />
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
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route element={<PermissionRoute permission="settings" />}>
                <Route path="/may-in" element={<WebPrintAgentPage />} />
              </Route>

              <Route element={<WebShell />}>
                <Route path="/" element={<WebHomePage />} />

                <Route element={<PermissionRoute permission="sell" />}>
                  <Route path="/ban-hang" element={<WebSalePage />} />
                  <Route path="/thanh-toan" element={<Navigate to="/ban-hang" replace />} />
                  <Route path="/don-hang" element={<WebOrdersPage />} />
                  <Route path="/don-hang/:id" element={<WebOrderDetailPage />} />
                  <Route path="/khach-hang" element={<WebCustomersPage />} />
                </Route>

                <Route element={<PermissionRoute permission="inventory" />}>
                  <Route path="/kho" element={<WebInventoryPage />} />
                  <Route path="/kho/:id" element={<WebProductDetailPage />} />
                  <Route path="/nhap-hang" element={<WebGoodsReceiptPage />} />
                  <Route path="/don-mua" element={<WebPurchaseOrdersPage />} />
                  <Route path="/kiem-ke" element={<WebStocktakePage />} />
                  <Route path="/cong-cu" element={<WebToolsPage />} />
                </Route>

                <Route element={<PermissionRoute permission="suppliers" />}>
                  <Route path="/nha-cung-cap" element={<WebSuppliersPage />} />
                </Route>

                <Route element={<PermissionRoute permission="reports" />}>
                  <Route path="/bao-cao" element={<WebReportsPage />} />
                </Route>

                <Route element={<PermissionRoute permission="settings" />}>
                  <Route path="/cai-dat" element={<WebSettingsPage />} />
                  <Route path="/thiet-bi" element={<WebDevicesPage />} />
                </Route>

                <Route element={<PermissionRoute permission="users" />}>
                  <Route path="/nguoi-dung" element={<WebUsersPage />} />
                </Route>

                <Route element={<PermissionRoute permission="invoices" />}>
                  <Route path="/hoa-don" element={<WebInvoicesPage />} />
                </Route>

                <Route path="/tai-khoan" element={<WebAccountPage />} />
                <Route path="/ghi-chu" element={<WebNotesPage />} />
                <Route path="/nhap-hang/hoa-don" element={<Navigate to="/nhap-hang" replace />} />
                <Route path="/doi-soat" element={<Navigate to="/cai-dat" replace />} />
                <Route path="/chuyen-tu-3su-cu" element={<Navigate to="/cai-dat" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        )}
        <ToastHost />
        <CelebrationHost />
      </div>
    </BrowserRouter>
  )
}
