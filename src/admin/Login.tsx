import { useState } from 'react'
import { loginAdmin } from './api'
import { setAdminSession } from './session'

export function AdminLogin({ onIn }: { onIn: () => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const res = await loginAdmin(username.trim(), password)
      setAdminSession(res.token, res.username)
      onIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Đăng nhập lỗi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-gate">
      <div className="admin-card">
        <p className="admin-kicker">3SU Control</p>
        <h1>Đăng nhập</h1>
        <p className="admin-lead">Tài khoản admin — không dùng Gmail shop.</p>
        <form
          className="admin-login-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="auth-field">
            <input
              className="auth-input"
              name="username"
              autoComplete="username"
              placeholder="Tài khoản"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="auth-field">
            <input
              className="auth-input"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Mật khẩu"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="auth-btn auth-btn-pri"
            disabled={busy || !username.trim() || !password}
          >
            Đăng nhập
          </button>
          {error && <p className="auth-error" role="alert">{error}</p>}
        </form>
      </div>
    </div>
  )
}
