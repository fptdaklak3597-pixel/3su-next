import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AdminLogin } from './Login'
import { AdminLayout } from './layout'
import { AdminStore } from './store'
import { Dashboard } from './Dashboard'
import { ShopList } from './ShopList'
import { ShopDetail } from './ShopDetail'
import { Alerts } from './Alerts'
import { AdminLog } from './Log'
import { listAdminShops } from './api'
import { clearAdminSession, getAdminToken } from './session'

function LegacyShop() {
  const { id = '' } = useParams()
  return <Navigate to={`/shops/${id}`} replace />
}

function Shell({ onSignOut, banner }: { onSignOut: () => void; banner: string }) {
  return (
    <AdminStore>
      <AdminLayout onSignOut={onSignOut} banner={banner}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/shops" element={<ShopList />} />
          <Route path="/shops/:id" element={<ShopDetail />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/log" element={<AdminLog />} />
          <Route path="/:id" element={<LegacyShop />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AdminLayout>
    </AdminStore>
  )
}

export function AdminApp() {
  const [inSession, setInSession] = useState(() => !!getAdminToken())
  const [denied, setDenied] = useState('')
  const [probed, setProbed] = useState(false)

  useEffect(() => {
    if (!inSession) {
      setDenied('')
      setProbed(false)
      return
    }
    let cancelled = false
    setProbed(false)
    void listAdminShops()
      .then(() => { if (!cancelled) { setDenied(''); setProbed(true) } })
      .catch((e: unknown) => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'Lỗi'
        if (msg === 'Thiếu token' || msg === 'Sai tài khoản hoặc mật khẩu' || msg.includes('Token')) {
          clearAdminSession()
          setInSession(false)
          return
        }
        setDenied(msg)
        setProbed(true)
      })
    return () => { cancelled = true }
  }, [inSession])

  function signOut() {
    clearAdminSession()
    setInSession(false)
  }

  if (!inSession) return <AdminLogin onIn={() => setInSession(true)} />

  if (!probed) {
    return <div className="admin-gate"><p>Đang kiểm tra quyền…</p></div>
  }

  if (denied === 'Không có quyền admin') {
    return (
      <div className="admin-gate">
        <div className="admin-card">
          <h1>Không có quyền</h1>
          <p className="admin-lead">Tài khoản không vào được admin.</p>
          <button type="button" className="auth-btn auth-btn-pri" onClick={signOut}>
            Đăng xuất
          </button>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Shell onSignOut={signOut} banner={denied && denied !== 'Không có quyền admin' ? denied : ''} />
    </BrowserRouter>
  )
}
