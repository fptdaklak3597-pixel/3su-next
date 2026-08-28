/**
 * Menu "Thêm" — chỉ giữ tính năng core và mục user được cấp quyền.
 */
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmtShort } from '@/core/format'
import { hasPerm } from '@/core/domain/auth'
import { totalSupplierDebt } from '@/core/domain/suppliers'
import { totalDebt } from '@/core/domain/sales'
import {
  ChevronLeft, ChevronRight, Truck, Users,
  UserCog, ClipboardList, BarChart3, Settings,
  Smartphone, FileText, Tags, Scale,
} from 'lucide-react'
import type { UserPerms } from '@/core/types'

interface MenuItem {
  path: string
  label: string
  desc: string
  icon: React.ReactNode
  color: string
  perm?: keyof UserPerms
}

export function MorePage() {
  const navigate = useNavigate()
  const me = useApp((s) => s.user)

  const suppliers = useLiveQuery(() => dbx.suppliers.filter((s) => !s.deleted).toArray(), [], [])
  const customers = useLiveQuery(() => dbx.customers.filter((c) => !c.deleted).toArray(), [], [])
  const receipts = useLiveQuery(() => dbx.goodsReceipts.toArray(), [], [])
  const supplierPayments = useLiveQuery(() => dbx.supplierPayments.toArray(), [], [])
  const users = useLiveQuery(() => dbx.users.filter((u) => !u.deleted).toArray(), [], [])

  const supDebt = totalSupplierDebt(suppliers, receipts, supplierPayments)
  const custDebt = totalDebt(customers)

  const items: MenuItem[] = [
    { path: '/nhap-hang', label: 'Nhập hàng', desc: 'Phiếu nhập kho nhanh', icon: <ClipboardList size={18} />, color: 'var(--up)', perm: 'inventory' },
    { path: '/don-mua', label: 'Đơn mua', desc: 'Đặt NCC rồi nhận vào kho', icon: <ClipboardList size={18} />, color: 'var(--gold)', perm: 'inventory' },
    { path: '/hoa-don', label: 'Hóa đơn', desc: 'Sổ hóa đơn GDT / nhập', icon: <FileText size={18} />, color: 'var(--ink-2)', perm: 'invoices' },
    { path: '/nha-cung-cap', label: 'Nhà cung cấp', desc: supDebt > 0 ? `${suppliers.length} NCC · nợ ${fmtShort(supDebt)}đ` : `${suppliers.length} nhà cung cấp`, icon: <Truck size={18} />, color: 'var(--gold)', perm: 'suppliers' },
    { path: '/cong-cu', label: 'Quy tắc giá', desc: 'Gợi ý giá bán theo biên lợi nhuận', icon: <Tags size={18} />, color: 'var(--gold)', perm: 'inventory' },
    { path: '/khach-hang', label: 'Khách hàng', desc: custDebt > 0 ? `${customers.length} khách · nợ ${fmtShort(custDebt)}đ` : `${customers.length} khách hàng`, icon: <Users size={18} />, color: 'var(--ink-3)', perm: 'sell' },
    { path: '/bao-cao', label: 'Báo cáo', desc: 'Doanh thu, lời, xu hướng', icon: <BarChart3 size={18} />, color: 'var(--up)', perm: 'reports' },
    { path: '/doi-soat', label: 'Đối soát', desc: 'So sổ tiền mặt, CK, nợ', icon: <Scale size={18} />, color: 'var(--ink-3)', perm: 'reports' },
    { path: '/nguoi-dung', label: 'Người dùng', desc: `${users.length} tài khoản`, icon: <UserCog size={18} />, color: 'var(--ink-2)', perm: 'users' },
    { path: '/thiet-bi', label: 'Thiết bị', desc: 'Kéo / đẩy bản sao cửa hàng', icon: <Smartphone size={18} />, color: 'var(--ink-2)', perm: 'settings' },
    { path: '/cai-dat', label: 'Cài đặt', desc: 'Shop, in, sao lưu', icon: <Settings size={18} />, color: 'var(--mute)', perm: 'settings' },
  ]

  const visible = items.filter((it) => !it.perm || !me || hasPerm(me, it.perm))

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate('/')}>
          <ChevronLeft size={20} />
        </button>
        <div className="font-brand text-[17px] font-medium flex-1 text-center" style={{ color: 'var(--ink)' }}>Thêm</div>
        <div className="w-9" />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 pb-6 max-w-[520px] mx-auto w-full">
        {visible.map((it) => (
          <button key={it.path} className="list-row" onClick={() => navigate(it.path)}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--paper-2)', color: it.color }}>
              {it.icon}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{it.label}</div>
              <div className="text-[11px] truncate" style={{ color: 'var(--mute)' }}>{it.desc}</div>
            </div>
            <ChevronRight size={16} style={{ color: 'var(--mute-2)' }} />
          </button>
        ))}
      </div>
    </div>
  )
}
