/**
 * 3SU Web — một thanh công cụ (KiotViet).
 * POS (/ban-hang) tự vẽ thanh riêng, shell chỉ còn khung.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Printer, Settings } from 'lucide-react'
import { useApp } from '@/core/store'
import { hasPerm } from '@/core/domain/auth'
import type { UserPerms } from '@/core/types'

type DropKey = 'hang' | 'giao' | 'doi' | 'he' | null

function NavDrop({
  k,
  open,
  label,
  active,
  onToggle,
  children,
}: {
  k: Exclude<DropKey, null>
  open: DropKey
  label: string
  active: boolean
  onToggle: (key: Exclude<DropKey, null>) => void
  children: ReactNode
}) {
  return (
    <div className={`web-drop ${open === k ? 'open' : ''}`}>
      <button
        type="button"
        className={`web-m ${active ? 'on' : ''}`}
        aria-expanded={open === k}
        aria-haspopup="menu"
        onClick={() => onToggle(k)}
      >
        {label} <span className="c">▾</span>
      </button>
      <div className="web-dd" role="menu">
        <div className="web-dd-menu">{children}</div>
      </div>
    </div>
  )
}

export function WebShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const shop = useApp((s) => s.shop)
  const sync = useApp((s) => s.sync)
  const online = useApp((s) => s.online)
  const user = useApp((s) => s.user)
  const [open, setOpen] = useState<DropKey>(null)
  const can = (k: keyof UserPerms) => !user || hasPerm(user, k)

  useEffect(() => {
    if (!open) return
    const main = document.querySelector('.web-main')
    const onMain = () => setOpen(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    main?.addEventListener('pointerdown', onMain)
    document.addEventListener('keydown', onKey)
    return () => {
      main?.removeEventListener('pointerdown', onMain)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle(key: Exclude<DropKey, null>) {
    setOpen((cur) => (cur === key ? null : key))
  }

  const path = location.pathname
  const posMode = path.startsWith('/ban-hang') || path.startsWith('/thanh-toan')

  const onOverview = path === '/'
  const onHang = path.startsWith('/kho') || path.startsWith('/kiem-ke')
  const onGiao = path.startsWith('/don-hang') || path.startsWith('/nhap-hang') || path.startsWith('/don-mua') || path.startsWith('/hoa-don')
  const onDoi = path.startsWith('/khach-hang') || path.startsWith('/nha-cung-cap')
  const onBao = path.startsWith('/bao-cao')
  const onHe = path.startsWith('/cai-dat') || path.startsWith('/nguoi-dung') || path.startsWith('/tai-khoan') || path.startsWith('/thiet-bi') || path.startsWith('/may-in') || path.startsWith('/ghi-chu') || path.startsWith('/cong-cu')

  const syncLabel = !online
    ? 'Mất mạng'
    : sync.status === 'syncing'
      ? 'Đang đồng bộ'
      : sync.status === 'ok'
        ? 'Đã đồng bộ'
        : sync.status === 'error'
          ? 'Lỗi đồng bộ'
          : 'Sẵn sàng'

  function go(to: string) {
    setOpen(null)
    navigate(to)
  }

  const syncClass = !online ? 'offline' : sync.status === 'ok' ? 'ok' : sync.status === 'syncing' ? 'syncing' : 'err'
  const initial = (user?.name || shop.name || 'T').trim().charAt(0).toUpperCase()

  return (
    <div className="web-layout">
      {!posMode && (
        <header className="web-chrome">
          <nav className="web-topbar" aria-label="Thanh công cụ">
            <button type="button" className="web-logo" onClick={() => go('/')}>3SU</button>

            <button type="button" className={`web-m ${onOverview ? 'on' : ''}`} onClick={() => go('/')}>Tổng quan</button>

            {can('inventory') && (
              <NavDrop k="hang" open={open} label="Hàng hóa" active={onHang} onToggle={toggle}>
                <button type="button" onClick={() => go('/kho')}>Danh sách hàng hóa<small>Giá lẻ / sỉ, tồn, HSD</small></button>
                <button type="button" onClick={() => go('/kiem-ke?tab=forecast')}>Dự báo nhập<small>Sắp hết theo tốc độ bán</small></button>
                <button type="button" onClick={() => go('/kiem-ke')}>Kiểm kê<small>Đối chiếu tồn thực tế</small></button>
              </NavDrop>
            )}

            {(can('sell') || can('inventory') || can('invoices')) && (
              <NavDrop k="giao" open={open} label="Giao dịch" active={onGiao} onToggle={toggle}>
                {can('sell') && <button type="button" onClick={() => go('/don-hang')}>Đơn hàng<small>Lịch sử + hủy hoàn kho</small></button>}
                {can('inventory') && <button type="button" onClick={() => go('/nhap-hang')}>Nhập hàng<small>Phiếu nhập kho</small></button>}
                {can('inventory') && <button type="button" onClick={() => go('/don-mua')}>Đơn mua<small>Đặt NCC rồi nhận vào kho</small></button>}
                {can('invoices') && <button type="button" onClick={() => go('/hoa-don')}>Hóa đơn<small>Sổ hóa đơn GDT / nhập</small></button>}
              </NavDrop>
            )}

            {(can('sell') || can('suppliers')) && (
              <NavDrop k="doi" open={open} label="Đối tác" active={onDoi} onToggle={toggle}>
                {can('sell') && <button type="button" onClick={() => go('/khach-hang')}>Khách hàng<small>Nợ, VIP, giá sỉ</small></button>}
                {can('suppliers') && <button type="button" onClick={() => go('/nha-cung-cap')}>Nhà cung cấp<small>Công nợ nhập</small></button>}
              </NavDrop>
            )}

            {can('reports') && (
              <button type="button" className={`web-m ${onBao ? 'on' : ''}`} onClick={() => go('/bao-cao')}>Báo cáo</button>
            )}

            <NavDrop k="he" open={open} label="Hệ thống" active={onHe} onToggle={toggle}>
              <button type="button" onClick={() => go('/tai-khoan')}>Tài khoản<small>Đăng nhập, đăng xuất và cửa hàng cloud</small></button>
              <button type="button" onClick={() => go('/ghi-chu')}>Ghi chú<small>Việc cần làm, ý tưởng</small></button>
              {can('settings') && <button type="button" onClick={() => go('/cai-dat')}>Cài đặt<small>Shop, in, sao lưu</small></button>}
              {can('settings') && <button type="button" onClick={() => go('/may-in')}>Máy in<small>Trang in bill trên máy này</small></button>}
              {can('settings') && <button type="button" onClick={() => go('/thiet-bi')}>Thiết bị<small>Kéo / đẩy bản sao cửa hàng</small></button>}
              {can('inventory') && <button type="button" onClick={() => go('/cong-cu')}>Quy tắc giá<small>Gợi ý giá bán theo biên lợi nhuận</small></button>}
              {can('users') && <button type="button" onClick={() => go('/nguoi-dung')}>Người dùng<small>PIN ca + phân quyền</small></button>}
            </NavDrop>

            {can('sell') && (
              <button
                type="button"
                className={`web-sale-btn web-sale-btn-nav ${path.startsWith('/ban-hang') ? 'on' : ''}`}
                onClick={() => go('/ban-hang')}
              >
                Bán hàng
              </button>
            )}

            <div className="web-bar-r">
              <span className="web-top-shop" title={shop.name || 'Cửa hàng'}>
                <span className="web-top-shop-name">{shop.name || 'Cửa hàng'}</span>
                <span className={`web-sync-status ${syncClass}`}>● {syncLabel}</span>
              </span>
              {can('settings') && (
                <button type="button" className="web-ico" onClick={() => go('/may-in')} aria-label="Máy in" title="Máy in">
                  <Printer size={16} />
                </button>
              )}
              {can('settings') && (
                <button type="button" className="web-ico" onClick={() => go('/cai-dat')} aria-label="Cài đặt" title="Cài đặt">
                  <Settings size={16} />
                </button>
              )}
              <button
                type="button"
                className="web-av web-av-btn"
                title={user?.name || shop.name || 'Tài khoản'}
                onClick={() => go('/tai-khoan')}
              >
                {initial}
              </button>
            </div>
          </nav>
        </header>
      )}

      <div className="web-main">
        <main className={posMode ? 'flex-1 min-h-0 flex flex-col' : 'screen-scroll'}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
