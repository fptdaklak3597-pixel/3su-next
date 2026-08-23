/**
 * Người dùng web — tạo tài khoản, phân quyền, đổi mật khẩu.
 */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { logError } from '@/core/errorLogger'
import {
  changePassword, createUser, deleteUser, hasPerm, PERM_LIST, ROLE_LABEL, updateUser,
} from '@/core/domain/auth'
import { ConfirmDialog, Sheet } from '@/shared/components'
import { WebEmpty } from '@/web/components/WebEmpty'
import type { User, UserPerms, UserRole } from '@/core/types'

export function WebUsersPage() {
  const showToast = useApp((s) => s.showToast)
  const me = useApp((s) => s.user)
  const [showAdd, setShowAdd] = useState(false)
  const [permTarget, setPermTarget] = useState<User | null>(null)
  const [pwTarget, setPwTarget] = useState<User | null>(null)
  const [delTarget, setDelTarget] = useState<User | null>(null)
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'staff' as UserRole })
  const [pw, setPw] = useState('')
  const [currentPw, setCurrentPw] = useState('')
  const [perms, setPerms] = useState<UserPerms>({})

  const users = useLiveQuery(() => dbx.users.filter((u) => !u.deleted).toArray(), [], [] as User[])
  const first = users.length === 0
  const canManage = first || !me || hasPerm(me, 'users')

  async function handleAdd() {
    try {
      await createUser({ ...form, role: first ? 'owner' : form.role })
      showToast('✓ Đã tạo tài khoản', 'ok')
      setForm({ username: '', name: '', password: '', role: 'staff' })
      setShowAdd(false)
    } catch (e) {
      logError(e, 'user.create')
      showToast(e instanceof Error ? e.message : 'Lỗi khi tạo', 'bad')
    }
  }

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
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>Người dùng</h2>
          <p>{users.length} tài khoản{first ? ' · tạo chủ cửa hàng đầu tiên' : ' · @tên + PIN đồng bộ sang máy khác khi đã vào cửa hàng'}</p>
        </div>
        {canManage && <button className="web-btn pri" onClick={() => setShowAdd(true)}>+ Thêm</button>}
      </div>

      {!canManage && (
        <p className="web-sub">Bạn không có quyền quản lý người dùng.</p>
      )}

      {users.length === 0 ? (
        <WebEmpty title="Chưa có tài khoản" sub="Tài khoản đầu tiên là chủ cửa hàng. Sau khi tạo, app sẽ yêu cầu đăng nhập.">
          <button className="web-btn pri" onClick={() => setShowAdd(true)}>+ Tạo chủ cửa hàng</button>
        </WebEmpty>
      ) : (
        <div className="web-table-wrap">
          <table className="web-table">
            <thead>
              <tr>
                <th>Tên</th>
                <th>Đăng nhập</th>
                <th>Vai trò</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="static">
                  <td>{u.name}{me?.id === u.id ? <span className="web-badge low ml-2">bạn</span> : null}{!u.active && <span className="web-badge out ml-2">khóa</span>}</td>
                  <td>@{u.username}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>
                    {canManage && (
                      <>
                        <button className="web-btn" style={{ height: 28 }} onClick={() => { setPermTarget(u); setPerms(u.perms ?? {}) }}>Quyền</button>
                        {' '}
                        <button className="web-btn" style={{ height: 28 }} onClick={() => { setPwTarget(u); setPw(''); setCurrentPw('') }}>Mật khẩu</button>
                        {me?.id !== u.id && u.role !== 'owner' && (
                          <>
                            {' '}
                            <button className="web-btn" style={{ height: 28 }} onClick={() => setDelTarget(u)}>Xóa</button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title={first ? 'Tạo chủ cửa hàng' : 'Thêm người dùng'}>
        <div className="flex flex-col gap-2">
          <input className="web-input" placeholder="Tên đăng nhập *" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input className="web-input" placeholder="Tên hiển thị" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="web-input" type="password" placeholder="Mật khẩu * (tối thiểu 4 ký tự)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {!first && (
            <div className="web-chips">
              {(['staff', 'admin'] as const).map((r) => (
                <button key={r} className={`web-chip ${form.role === r ? 'on' : ''}`} onClick={() => setForm({ ...form, role: r })}>{ROLE_LABEL[r]}</button>
              ))}
            </div>
          )}
          <button className="web-btn pri" onClick={handleAdd}>{first ? 'Tạo và đăng nhập sau' : 'Tạo tài khoản'}</button>
        </div>
      </Sheet>

      <Sheet open={!!permTarget} onClose={() => setPermTarget(null)} title={permTarget ? `Quyền · ${permTarget.name}` : 'Quyền'}>
        {permTarget && (permTarget.role === 'owner' || permTarget.role === 'admin') ? (
          <p className="text-sm" style={{ color: 'var(--kv-muted)' }}>{ROLE_LABEL[permTarget.role]} có toàn quyền.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between">
              <span>Toàn quyền</span>
              <input type="checkbox" checked={!!perms.all} onChange={() => setPerms((p) => ({ ...p, all: !p.all }))} />
            </label>
            {PERM_LIST.map(({ k, l }) => (
              <label key={k} className="flex items-center justify-between" style={{ opacity: perms.all ? 0.5 : 1 }}>
                <span>{l}</span>
                <input type="checkbox" disabled={!!perms.all} checked={!!perms.all || !!perms[k]} onChange={() => setPerms((p) => ({ ...p, [k]: !p[k] }))} />
              </label>
            ))}
            <button className="web-btn pri" onClick={async () => {
              if (!permTarget) return
              try {
                await updateUser(permTarget.id, { perms })
                showToast('✓ Đã lưu phân quyền', 'ok')
                setPermTarget(null)
              } catch (e) {
                logError(e, 'user.perms')
                showToast('Lỗi khi lưu', 'bad')
              }
            }}>Lưu</button>
          </div>
        )}
      </Sheet>

      <Sheet open={!!pwTarget} onClose={() => setPwTarget(null)} title={pwTarget ? `Mật khẩu · ${pwTarget.name}` : 'Mật khẩu'}>
        {pwTarget && me?.id === pwTarget.id && (
          <input
            className="web-input mb-2"
            type="password"
            placeholder="Mật khẩu hiện tại"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            autoComplete="current-password"
          />
        )}
        <input className="web-input mb-2" type="password" placeholder="Mật khẩu mới" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <button className="web-btn pri w-full" onClick={async () => {
          if (!pwTarget) return
          try {
            const self = me?.id === pwTarget.id
            await changePassword(pwTarget.id, pw, self ? { currentPassword: currentPw } : undefined)
            showToast('✓ Đã đổi mật khẩu', 'ok')
            setPwTarget(null)
            setCurrentPw('')
          } catch (e) {
            logError(e, 'user.password')
            showToast(e instanceof Error ? e.message : 'Lỗi', 'bad')
          }
        }}>Đổi mật khẩu</button>
      </Sheet>

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
