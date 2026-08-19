import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Bell, LayoutDashboard, ScrollText, Store } from 'lucide-react'
import { getAdminUsername } from './session'
import { useAdminStore } from './store'

function vnClock(now = Date.now()): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(now)).replace(',', '')
}

export function AdminLayout({
  children,
  onSignOut,
  banner,
}: {
  children: ReactNode
  onSignOut: () => void
  banner?: string
}) {
  const { q, setQ, alertCount } = useAdminStore()
  const loc = useLocation()
  const nav = useNavigate()
  const [clock, setClock] = useState(() => vnClock())

  useEffect(() => {
    const t = setInterval(() => setClock(vnClock()), 30_000)
    return () => clearInterval(t)
  }, [])

  const onList = loc.pathname === '/' || loc.pathname === '/shops'

  function onSearch(value: string) {
    setQ(value)
    if (!onList) nav(`/shops?q=${encodeURIComponent(value)}`)
  }

  return (
    <div className="admin-app">
      <header className="admin-top">
        <Link to="/" className="admin-brand">3SU Control</Link>
        <input
          className="admin-top-search"
          placeholder="Tìm shop, Gmail, SĐT…"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
        />
        <span className="admin-clock">{clock}</span>
        <span className="admin-who">{getAdminUsername()}</span>
        <button type="button" className="admin-out" onClick={onSignOut}>Đăng xuất</button>
      </header>
      <div className="admin-body">
        <nav className="admin-side">
          <NavLink to="/" end> <LayoutDashboard size={16} /> Tổng quan</NavLink>
          <NavLink to="/shops"> <Store size={16} /> Đội shop</NavLink>
          <NavLink to="/alerts">
            <Bell size={16} /> Cảnh báo
            {alertCount > 0 ? <span className="admin-nav-badge">{alertCount}</span> : null}
          </NavLink>
          <NavLink to="/log"> <ScrollText size={16} /> Nhật ký</NavLink>
        </nav>
        <main className="admin-main">
          {banner ? <p className="admin-err">{banner}</p> : null}
          {children}
        </main>
      </div>
    </div>
  )
}
