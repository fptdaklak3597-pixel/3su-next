/**
 * Chờ bấm liên kết trong mail từ 3su.shop@gmail.com rồi mới vào shop.
 */
import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import {
  CLOUD_MAIL_FROM,
  clearEmailForSignIn,
  cloudAuthMessage,
  cloudMailHint,
  cloudSendEmailLink,
  completeEmailLinkSignIn,
  peekEmailForSignIn,
  pushCloudSession,
  refreshCloudUser,
} from '@/core/sync/firebase'
import { enterExistingCloudShop } from '@/core/sync/cloud'
import { logError } from '@/core/errorLogger'
import { markCloudShopEntered } from './useCloudSession'

export function CloudVerifyEmail({
  email,
  onReady,
  onBack,
  onError,
  onInfo,
}: {
  email?: string
  pair?: string
  onReady: (shopId: string) => void
  onBack?: () => void
  onError?: (msg: string) => void
  onInfo?: (msg: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const to = email || peekEmailForSignIn()

  async function enterIfReady(silentFail: boolean) {
    setBusy(true)
    try {
      try { await completeEmailLinkSignIn(to) } catch { /* chưa bấm link */ }
      const u = await refreshCloudUser({ silent: true })
      if (!u) {
        if (!silentFail) onError?.(`Chưa thấy xác nhận. ${cloudMailHint('verify')}`)
        return
      }
      const shopId = await enterExistingCloudShop()
      pushCloudSession()
      if (shopId) {
        markCloudShopEntered()
        onReady(shopId)
        return
      }
      onReady('')
    } catch (e) {
      onError?.(cloudAuthMessage(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void enterIfReady(true)
    function onVis() {
      if (document.visibilityState === 'visible') void enterIfReady(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [to])

  return (
    <div className="auth-form">
      <div className="auth-verify-icon" aria-hidden="true">
        <Mail size={22} strokeWidth={1.75} />
      </div>
      <h1>Kiểm tra hộp thư</h1>
      <p className="auth-lead">
        Đã gửi mail tới <strong>{to || 'email vừa nhập'}</strong>.
        {' '}{cloudMailHint('verify')}
      </p>
      <p className="auth-from">Người gửi: {CLOUD_MAIL_FROM}</p>
      <button
        type="button"
        className="auth-btn auth-btn-pri"
        data-busy={busy || undefined}
        disabled={busy}
        onClick={() => void enterIfReady(false)}
      >
        Tôi đã xác nhận
      </button>
      <button
        type="button"
        className="auth-btn"
        data-busy={busy || undefined}
        disabled={busy || !to}
        onClick={() => void (async () => {
          setBusy(true)
          try {
            await cloudSendEmailLink(to)
            onInfo?.(`Đã gửi lại mail từ ${CLOUD_MAIL_FROM}.`)
          } catch (e) {
            logError(e, 'auth.resend')
            onError?.(cloudAuthMessage(e))
          } finally {
            setBusy(false)
          }
        })()}
      >
        Gửi lại mail
      </button>
      <button
        type="button"
        className="auth-switch"
        disabled={busy}
        onClick={() => {
          clearEmailForSignIn()
          onBack?.()
        }}
      >
        Đổi email
      </button>
    </div>
  )
}
