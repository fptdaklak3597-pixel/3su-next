/**
 * Đăng nhập cloud — Google hoặc email.
 * Cùng email chủ → vào shop có sẵn. Máy mới / nhân viên: sang bước nhập mã.
 */
import { useState } from 'react'
import {
  clearEmailForSignIn,
  cloudAuthMessage,
  cloudSendEmailLink,
  cloudSignInGoogle,
  completeEmailLinkSignIn,
  isEmailLinkInUrl,
  peekEmailForSignIn,
  takeAuthError,
} from '@/core/sync/firebase'
import { enterExistingCloudShop } from '@/core/sync/cloud'
import { logError } from '@/core/errorLogger'
import { markCloudShopEntered } from './useCloudSession'
import { CloudVerifyEmail } from './CloudVerifyEmail'
import { CloudShopJoin } from './CloudShopJoin'

function GoogleMark() {
  return (
    <svg className="auth-google-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.4c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.3 7.4 24 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.4c-.2-.7-.4-1.4-.4-2.4V6.5H1.4C.5 8.3 0 10.1 0 12s.5 3.7 1.4 5.5l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.1 15.2 0 12 0 7.4 0 3.4 2.7 1.4 6.5l4 3.1C6.3 6.8 8.9 4.8 12 4.8z" />
    </svg>
  )
}

export function WebCloudAuth({
  onReady,
  onError,
  onInfo,
  embed = false,
}: {
  onReady: (shopId: string) => void
  onError?: (msg: string) => void
  onInfo?: (msg: string) => void
  embed?: boolean
}) {
  const [email, setEmail] = useState(peekEmailForSignIn())
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState('')
  const [needShop, setNeedShop] = useState(false)
  const [error, setError] = useState(takeAuthError)

  function fail(e: unknown) {
    logError(e, 'auth.cloud')
    const msg = cloudAuthMessage(e)
    setError(msg)
    onError?.(msg)
  }

  async function finish() {
    const shopId = await enterExistingCloudShop()
    if (shopId) {
      markCloudShopEntered()
      onReady(shopId)
      return
    }
    setNeedShop(true)
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await fn() }
    catch (e) { fail(e) }
    finally { setBusy(false) }
  }

  if (needShop) {
    return <CloudShopJoin onReady={onReady} onError={onError} />
  }

  if (sentTo) {
    return (
      <CloudVerifyEmail
        email={sentTo || email}
        onReady={(id) => {
          if (id) onReady(id)
          else setNeedShop(true)
        }}
        onError={onError}
        onInfo={onInfo}
        onBack={() => {
          clearEmailForSignIn()
          setSentTo('')
        }}
      />
    )
  }

  if (isEmailLinkInUrl() && !peekEmailForSignIn()) {
    return (
      <div className="auth-form">
        {embed && <h1>Hoàn tất đăng nhập</h1>}
        <p className="auth-lead">Nhập lại email vừa nhận mail để vào cửa hàng.</p>
        <label className="auth-field">
          <span className="sr-only">Email</span>
          <input
            className="auth-input"
            type="email"
            name="email"
            autoComplete="email"
            autoCapitalize="none"
            placeholder="Nhập email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              void withBusy(async () => {
                await completeEmailLinkSignIn(email.trim())
                await finish()
              })
            }}
          />
        </label>
        <button
          type="button"
          className="auth-btn auth-btn-pri"
          data-busy={busy || undefined}
          disabled={busy || !email.trim()}
          onClick={() => void withBusy(async () => {
            await completeEmailLinkSignIn(email.trim())
            await finish()
          })}
        >
          Vào cửa hàng
        </button>
        {error && <p className="auth-error" role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <div className="auth-form">
      {embed && <h1>Vào cửa hàng</h1>}

      <button
        type="button"
        className="auth-btn auth-btn-google"
        data-busy={busy || undefined}
        disabled={busy}
        onClick={() => void withBusy(async () => {
          const u = await cloudSignInGoogle()
          if (u) await finish()
        })}
      >
        <GoogleMark />
        Tiếp tục với Google
      </button>

      <p className="auth-or"><span>HOẶC</span></p>

      <label className="auth-field">
        <span className="sr-only">Email</span>
        <input
          className="auth-input"
          type="email"
          name="email"
          autoComplete="email"
          autoCapitalize="none"
          placeholder="Nhập email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            void withBusy(sendLink)
          }}
        />
      </label>

      <button
        type="button"
        className="auth-btn auth-btn-pri"
        data-busy={busy || undefined}
        disabled={busy || !email.trim()}
        onClick={() => void withBusy(sendLink)}
      >
        Tiếp tục với email
      </button>
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  )

  async function sendLink() {
    await cloudSendEmailLink(email.trim())
    setSentTo(email.trim())
  }
}
