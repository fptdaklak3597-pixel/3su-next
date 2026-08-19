/**
 * 3SU Next — Người dùng & Phân quyền
 * Port từ 50-auth-cloud-ai.js (users): tạo tài khoản, phân quyền, đổi mật khẩu.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { logError } from '@/core/errorLogger'
import {
  createUser, updateUser, deleteUser, changePassword,
  PERM_LIST, ROLE_LABEL, hasPerm,
} from '@/core/domain/auth'
import { Sheet, ConfirmDialog, EmptyState } from '@/shared/components'
import { ChevronLeft, Plus, Trash2, KeyRound, ShieldCheck } from 'lucide-react'
import type { User, UserRole, UserPerms } from '@/core/types'

export function UsersPage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const me = useApp((s) => s.user)
  const [showAdd, setShowAdd] = useState(false)
  const [permTarget, setPermTarget] = useState<User | null>(null)
  const [pwTarget, setPwTarget] = useState<User | null>(null)
  const [delTarget, setDelTarget] = useState<User | null>(null)

  const users = useLiveQuery(() => dbx.users.filter((u) => !u.deleted).toArray(), [], [] as User[])

  const canManage = hasPerm(me, 'users')

  async function handleDelete() {
    if (!delTarget) return
    try {
      await deleteUser(delTarget.id)
      showToast('Đã xóa tài khoản', 'ok')
      setDelTarget(null)
    } catch (e) {
      logError(e, 'user.delete')
      showToast('Lỗi khi xóa', 'bad')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate('/them')}>
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 text-center">
          <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Người dùng</div>
          <div className="text-[11px]" style={{ color: 'var(--mute)' }}>{users.length} tài khoản · PIN đồng bộ khi đã vào cửa hàng</div>
        </div>
        {canManage && (
          <button className="btn-back" onClick={() => setShowAdd(true)} aria-label="Thêm người dùng">
            <Plus size={18} />
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 pb-6">
        {!canManage && (
          <div className="text-xs px-3 py-2 rounded-xl mb-3" style={{ background: 'var(--paper-2)', color: 'var(--mute)' }}>
            Bạn không có quyền quản lý người dùng.
          </div>
        )}
        {users.map((u) => (
          <div key={u.id} className="list-row">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-brand font-medium"
              style={{ background: 'var(--paper-2)', color: 'var(--ink-2)' }}>
              {u.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{u.name}</span>
                {me?.id === u.id && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--paper-2)', color: 'var(--gold)' }}>bạn</span>}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
                @{u.username} · {ROLE_LABEL[u.role]} {!u.active && '· khóa'}
              </div>
            </div>
            {canManage && (
              <div className="flex items-center gap-1">
                <button className="p-1.5" onClick={() => setPermTarget(u)} aria-label="Phân quyền" style={{ color: 'var(--gold)' }}>
                  <ShieldCheck size={16} />
                </button>
                <button className="p-1.5" onClick={() => setPwTarget(u)} aria-label="Đổi mật khẩu" style={{ color: 'var(--mute)' }}>
                  <KeyRound size={15} />
                </button>
                {me?.id !== u.id && u.role !== 'owner' && (
                  <button className="p-1.5" onClick={() => setDelTarget(u)} aria-label="Xóa" style={{ color: 'var(--mute-2)' }}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {users.length === 0 && <EmptyState icon="👤" title="Chưa có tài khoản" sub="Bấm + để tạo tài khoản nhân viên" />}
      </div>

      <AddUserSheet open={showAdd} onClose={() => setShowAdd(false)} />
      {permTarget && <PermSheet user={permTarget} onClose={() => setPermTarget(null)} />}
      {pwTarget && <PasswordSheet user={pwTarget} onClose={() => setPwTarget(null)} />}

      <ConfirmDialog
        open={!!delTarget}
        title="Xóa tài khoản?"
        message={`Xóa tài khoản @${delTarget?.username}? Người này sẽ không đăng nhập được nữa.`}
        confirmLabel="Xóa"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  )
}

/* ─── Thêm người dùng ─── */
function AddUserSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const showToast = useApp((s) => s.showToast)
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'staff' as UserRole })

  async function handleAdd() {
    try {
      await createUser(form)
      showToast('✓ Đã tạo tài khoản', 'ok')
      setForm({ username: '', name: '', password: '', role: 'staff' })
      onClose()
    } catch (e) {
      logError(e, 'user.create')
      showToast(e instanceof Error ? e.message : 'Lỗi khi tạo', 'bad')
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Thêm người dùng">
      <div className="flex flex-col gap-3">
        <input className="field-input" placeholder="Tên đăng nhập *" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <input className="field-input" placeholder="Tên hiển thị" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="field-input" placeholder="Mật khẩu * (tối thiểu 4 ký tự)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <div className="flex gap-2">
          {(['staff', 'admin'] as const).map((r) => (
            <button key={r} className="chip flex-1 justify-center" style={form.role === r ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : {}} onClick={() => setForm({ ...form, role: r })}>
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <p className="text-[11px]" style={{ color: 'var(--mute)' }}>
          {form.role === 'admin' ? 'Quản trị có toàn quyền.' : 'Nhân viên cần được phân quyền chi tiết sau khi tạo.'}
        </p>
        <button className="btn-cta" onClick={handleAdd}>Tạo tài khoản</button>
      </div>
    </Sheet>
  )
}

/* ─── Phân quyền ─── */
function PermSheet({ user, onClose }: { user: User; onClose: () => void }) {
  const showToast = useApp((s) => s.showToast)
  const [perms, setPerms] = useState<UserPerms>(user.perms ?? {})
  const isPrivileged = user.role === 'owner' || user.role === 'admin'

  async function handleSave() {
    try {
      await updateUser(user.id, { perms })
      showToast('✓ Đã lưu phân quyền', 'ok')
      onClose()
    } catch (e) {
      logError(e, 'user.perms')
      showToast('Lỗi khi lưu', 'bad')
    }
  }

  function toggle(k: keyof UserPerms) {
    setPerms((p) => ({ ...p, [k]: !p[k] }))
  }

  return (
    <Sheet open onClose={onClose} title={`Phân quyền — ${user.name}`}>
      {isPrivileged ? (
        <p className="text-sm" style={{ color: 'var(--mute)' }}>
          {ROLE_LABEL[user.role]} có toàn quyền, không cần phân quyền chi tiết.
        </p>
      ) : (
        <div className="flex flex-col">
          <label className="flex items-center justify-between py-2.5 cursor-pointer" style={{ borderBottom: '0.5px solid var(--hair-2)' }} onClick={() => setPerms((p) => ({ ...p, all: !p.all }))}>
            <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Toàn quyền</span>
            <Toggle on={!!perms.all} />
          </label>
          {PERM_LIST.map(({ k, l }) => (
            <label key={k} className="flex items-center justify-between py-2.5 cursor-pointer" style={{ borderBottom: '0.5px solid var(--hair-2)', opacity: perms.all ? 0.5 : 1 }} onClick={() => !perms.all && toggle(k)}>
              <span className="text-sm" style={{ color: 'var(--ink-2)' }}>{l}</span>
              <Toggle on={!!perms.all || !!perms[k]} />
            </label>
          ))}
          <button className="btn-cta mt-4" onClick={handleSave}>Lưu phân quyền</button>
        </div>
      )}
    </Sheet>
  )
}

/* ─── Đổi mật khẩu ─── */
function PasswordSheet({ user, onClose }: { user: User; onClose: () => void }) {
  const showToast = useApp((s) => s.showToast)
  const [pw, setPw] = useState('')

  async function handleSave() {
    try {
      await changePassword(user.id, pw)
      showToast('✓ Đã đổi mật khẩu', 'ok')
      setPw('')
      onClose()
    } catch (e) {
      logError(e, 'user.password')
      showToast(e instanceof Error ? e.message : 'Lỗi', 'bad')
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Đổi mật khẩu — ${user.name}`}>
      <div className="flex flex-col gap-3">
        <input className="field-input" placeholder="Mật khẩu mới (tối thiểu 4 ký tự)" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        <button className="btn-cta" onClick={handleSave}>Đổi mật khẩu</button>
      </div>
    </Sheet>
  )
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span className="w-10 h-6 rounded-full relative transition-colors flex-shrink-0" style={{ background: on ? 'var(--up)' : 'var(--hair)' }}>
      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all" style={{ left: on ? 18 : 2 }} />
    </span>
  )
}
