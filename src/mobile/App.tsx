/**
 * 3SU Next — Mobile App (PWA bán hàng)
 * Root component: boot DB, sync, theme, routing.
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
import { MobileShell } from './layout/MobileShell'
import { LoginPage } from './pages/LoginPage'
import { useCloudSession } from '@/shared/useCloudSession'
import { AuthBootSplash, CloudAuthScreen, CloudShopJoinScreen } from '@/shared/CloudAuthScreen'
import { ShopLicenseScreen, useShopLicense } from '@/shared/ShopLicenseGate'
import { isLicenseBlocked } from '@/core/sync/license'
import { useShopUsageTracker } from '@/core/sync/usageTracker'

const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })))
const SalePage = lazy(() => import('./pages/SalePage').then((m) => ({ default: m.SalePage })))
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })))
const OrdersPage = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })))
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage').then((m) => ({ default: m.OrderDetailPage })))
const InventoryPage = lazy(() => import('./pages/InventoryPage').then((m) => ({ default: m.InventoryPage })))
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage })))
const CustomersPage = lazy(() => import('./pages/CustomersPage').then((m) => ({ default: m.CustomersPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const GoodsReceiptPage = lazy(() => import('./pages/GoodsReceiptPage').then((m) => ({ default: m.GoodsReceiptPage })))
const InvoiceImportPage = lazy(() => import('./pages/InvoiceImportPage').then((m) => ({ default: m.InvoiceImportPage })))
const PurchaseOrdersPage = lazy(() => import('./pages/PurchaseOrdersPage').then((m) => ({ default: m.PurchaseOrdersPage })))
const StocktakePage = lazy(() => import('./pages/StocktakePage').then((m) => ({ default: m.StocktakePage })))
const SuppliersPage = lazy(() => import('./pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage })))
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })))
const DevicesPage = lazy(() => import('./pages/DevicesPage').then((m) => ({ default: m.DevicesPage })))
const InvoicesPage = lazy(() => import('./pages/InvoicesPage').then((m) => ({ default: m.InvoicesPage })))
const ToolsPage = lazy(() => import('./pages/ToolsPage').then((m) => ({ default: m.ToolsPage })))
const MorePage = lazy(() => import('./pages/MorePage').then((m) => ({ default: m.MorePage })))

function RouteFallback() {
  return <div className="p-6 text-sm" style={{ color: 'var(--mute)' }}>Đang tải…</div>
}

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
              <Route element={<MobileShell />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/them" element={<MorePage />} />

                <Route element={<PermissionRoute permission="sell" />}>
                  <Route path="/ban-hang" element={<SalePage />} />
                  <Route path="/thanh-toan" element={<CheckoutPage />} />
                  <Route path="/don-hang" element={<OrdersPage />} />
                  <Route path="/don-hang/:id" element={<OrderDetailPage />} />
                  <Route path="/khach-hang" element={<CustomersPage />} />
                </Route>

                <Route element={<PermissionRoute permission="inventory" />}>
                  <Route path="/kho" element={<InventoryPage />} />
                  <Route path="/kho/:id" element={<ProductDetailPage />} />
                  <Route path="/nhap-hang" element={<GoodsReceiptPage />} />
                  <Route path="/nhap-hang/hoa-don" element={<InvoiceImportPage />} />
                  <Route path="/don-mua" element={<PurchaseOrdersPage />} />
                  <Route path="/kiem-ke" element={<StocktakePage />} />
                  <Route path="/cong-cu" element={<ToolsPage />} />
                </Route>

                <Route element={<PermissionRoute permission="reports" />}>
                  <Route path="/bao-cao" element={<ReportsPage />} />
                </Route>

                <Route element={<PermissionRoute permission="settings" />}>
                  <Route path="/cai-dat" element={<SettingsPage />} />
                  <Route path="/thiet-bi" element={<DevicesPage />} />
                </Route>

                <Route element={<PermissionRoute permission="suppliers" />}>
                  <Route path="/nha-cung-cap" element={<SuppliersPage />} />
                </Route>

                <Route element={<PermissionRoute permission="users" />}>
                  <Route path="/nguoi-dung" element={<UsersPage />} />
                </Route>

                <Route element={<PermissionRoute permission="invoices" />}>
                  <Route path="/hoa-don" element={<InvoicesPage />} />
                </Route>

                <Route path="/chuyen-tu-3su-cu" element={<Navigate to="/cai-dat" replace />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        )}
        <ToastHost />
        <CelebrationHost />
      </div>
    </BrowserRouter>
  )
}
