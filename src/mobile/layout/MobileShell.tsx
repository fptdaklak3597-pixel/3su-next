/**
 * 3SU Next — Mobile Shell
 * Tab: Trang chủ · Bán hàng · Đơn · Kho · Thêm (Khách nằm trong sheet Thêm).
 * Ẩn tab bar trên /ban-hang và /thanh-toan (màn POS/checkout fullscreen).
 */
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Home, ShoppingCart, ClipboardList, Package, Menu } from 'lucide-react'
import { ToolsSheet } from './ToolsSheet'

const TABS = [
  { path: '/', label: 'Trang chủ', icon: Home },
  { path: '/ban-hang', label: 'Bán hàng', icon: ShoppingCart },
  { path: '/don-hang', label: 'Đơn', icon: ClipboardList },
  { path: '/kho', label: 'Kho', icon: Package },
]

const HIDE_TAB = ['/ban-hang', '/thanh-toan']
const MORE_ACTIVE = [
  '/bao-cao', '/cai-dat', '/nha-cung-cap', '/nhap-hang',
  '/them', '/nguoi-dung', '/khach-hang',
]

export function MobileShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const [toolsOpen, setToolsOpen] = useState(false)

  const hideBar = HIDE_TAB.some((p) => location.pathname.startsWith(p))
  const moreOn = MORE_ACTIVE.some((p) => location.pathname.startsWith(p))

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <>
      <main className="screen-scroll screen-enter">
        <Outlet />
      </main>
      {!hideBar && (
        <nav className="tab-bar" aria-label="Điều hướng chính">
          {TABS.map((tab) => {
            const active = isActive(tab.path)
            const Icon = tab.icon
            return (
              <button
                key={tab.path}
                className={`tab-item ${active ? 'active' : ''}`}
                onClick={() => navigate(tab.path)}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                <span>{tab.label}</span>
              </button>
            )
          })}
          <button
            className={`tab-item ${moreOn || toolsOpen ? 'active' : ''}`}
            onClick={() => setToolsOpen(true)}
          >
            <Menu size={20} strokeWidth={moreOn || toolsOpen ? 2.2 : 1.8} />
            <span>Thêm</span>
          </button>
        </nav>
      )}
      <ToolsSheet open={toolsOpen} onClose={() => setToolsOpen(false)} />
    </>
  )
}
