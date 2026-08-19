/**
 * 3SU Next — Đăng nhập (Login)
 * Chỉ hiện khi đã có tài khoản trong máy mà chưa đăng nhập.
 * Lần đầu (chưa có ai): cho phép tạo nhanh tài khoản Chủ cửa hàng.
 * NV: chọn tên + bàn phím PIN (mật khẩu số).
 */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx, setCurrentUser } from '@/core/db'
import { useApp } from '@/core/store'
import { logError } from '@/core/errorLogger'
import { login, createUser, changePassword } from '@/core/domain/auth'
import { Store, LogIn, Delete } from 'lucide-react'
import type { User } from '@/core/types'

export function LoginPage() {
  const shop = useApp((s) => s.shop)
  const setUser = useApp((s) => s.setUser)
  const showToast = useApp((s) => s.showToast)

  const users = useLiveQuery(() => dbx.users.filter((u) => !u.deleted && u.active).toArray(), [], [] as User[])
  const hasUsers = users.length > 0

  const [mode, setMode] = useState<'login' | 'setup'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<User | null>(null)
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')

  async function finishLogin(u: User) {
    if (u.passwordNeedsReset) {
      setPending(u)
      setPassword('')
      return
    }
    await setCurrentUser(u)
    setUser(u)
    showToast(`Xin chào ${u.name}!`, 'ok')
  }

  async function handleLogin() {
    if (!username.trim() || !password) { showToast('Nhập đủ thông tin', 'bad'); return }
    setBusy(true)
    try {
      const u = await login(username, password)
      await finishLogin(u)
    } catch (e) {
      logError(e, 'auth.login')
      showToast(e instanceof Error ? e.message : 'Đăng nhập thất bại', 'bad')
    } finally {
      setBusy(false)
    }
  }

  async function handleSetup() {
    if (!username.trim() || !password) { showToast('Nhập đủ thông tin', 'bad'); return }
    setBusy(true)
    try {
      const u = await createUser({ username, name: name.trim() || 'Chủ cửa hàng', password, role: 'owner' })
      await finishLogin(u)
    } catch (e) {
      logError(e, 'auth.setup')
      showToast(e instanceof Error ? e.message : 'Lỗi khi tạo', 'bad')
    } finally {
      setBusy(false)
    }
  }

  async function handleReset() {
    if (!pending) return
    if (newPw.length < 4) { showToast('Mật khẩu tối thiểu 4 ký tự', 'bad'); return }
    if (newPw !== newPw2) { showToast('Hai mật khẩu không khớp', 'bad'); return }
    setBusy(true)
    try {
      await changePassword(pending.id, newPw)
      const u = { ...pending, passwordNeedsReset: false }
      await setCurrentUser(u)
      setUser(u)
      setPending(null)
      showToast(`Xin chào ${u.name}!`, 'ok')
    } catch (e) {
      logError(e, 'auth.reset')
      showToast(e instanceof Error ? e.message : 'Lỗi đổi mật khẩu', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const setup = !hasUsers || mode === 'setup'

  if (pending) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-10" style={{ background: 'var(--paper)' }}>
        <div className="w-full max-w-[360px] card p-5 flex flex-col gap-3">
          <div className="font-brand text-lg" style={{ color: 'var(--ink)' }}>Đổi mật khẩu lần đầu</div>
          <p className="text-sm" style={{ color: 'var(--mute)' }}>{pending.name} — mật khẩu tạm, hãy đặt mật khẩu mới.</p>
          <input className="field-input" type="password" placeholder="Mật khẩu mới" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <input className="field-input" type="password" placeholder="Nhập lại" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void handleReset()} />
          <button className="btn-cta" disabled={busy} onClick={() => void handleReset()}>Lưu và vào app</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-10" style={{ background: 'var(--paper)' }}>
      <div className="w-full max-w-[360px]">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
            <Store size={26} />
          </div>
          <div className="font-brand text-xl font-medium" style={{ color: 'var(--ink)' }}>{shop.name}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--mute)' }}>
            {setup ? 'Tạo tài khoản chủ cửa hàng để bắt đầu' : 'Chọn tên rồi nhập PIN / mật khẩu'}
          </div>
        </div>

        <div className="card p-5 flex flex-col gap-3">
          {setup && (
            <input className="field-input" placeholder="Tên hiển thị" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          {!setup && users.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="chip"
                  style={username === u.username ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : {}}
                  onClick={() => { setUsername(u.username); setPassword('') }}
                >
                  {u.name}
                </button>
              ))}
            </div>
          )}
          <input
            className="field-input"
            placeholder="Tên đăng nhập"
            autoCapitalize="none"
            autoCorrect="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="field-input"
            placeholder="PIN hoặc mật khẩu"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (setup ? handleSetup() : handleLogin())}
          />
          {!setup && (
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) => (
                k === '' ? <div key="sp" /> : (
                  <button
                    key={k}
                    type="button"
                    className="chip justify-center py-3 text-lg"
                    onClick={() => {
                      if (k === 'del') setPassword((p) => p.slice(0, -1))
                      else setPassword((p) => (p + k).slice(0, 8))
                    }}
                  >
                    {k === 'del' ? <Delete size={16} /> : k}
                  </button>
                )
              ))}
            </div>
          )}
          <button className="btn-cta mt-1 flex items-center justify-center gap-2" disabled={busy} onClick={setup ? handleSetup : handleLogin}>
            <LogIn size={16} /> {setup ? 'Tạo & đăng nhập' : 'Đăng nhập'}
          </button>
        </div>

        {hasUsers && (
          <button
            className="btn-ghost text-sm w-full mt-4"
            onClick={() => { setMode(setup ? 'login' : 'setup'); setPassword('') }}
          >
            {setup ? '← Quay lại đăng nhập' : 'Tạo tài khoản mới'}
          </button>
        )}
      </div>
    </div>
  )
}
