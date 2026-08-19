/**
 * Chưa có shop: chọn shop đã có, tạo mới hoặc vào bằng mã.
 * Không tự lấy shop đầu tiên khi tài khoản thuộc nhiều cửa hàng.
 */
import { useEffect, useState } from 'react'
import {
  connectCloud,
  createCloudShop,
  enterExistingCloudShop,
  listCloudShops,
  redeemPairCode,
  selectCloudShop,
  type CloudShopRow,
} from '@/core/sync/cloud'
import { markCloudShopEntered } from './useCloudSession'

export function CloudShopJoin({
  onReady,
  onError,
}: {
  onReady: (shopId: string) => void
  onError?: (msg: string) => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [shops, setShops] = useState<CloudShopRow[]>([])

  useEffect(() => {
    let cancelled = false
    void listCloudShops()
      .then((rows) => { if (!cancelled) setShops(rows) })
      .then(() => enterExistingCloudShop())
      .then((id) => {
        if (cancelled || !id) return
        markCloudShopEntered()
        onReady(id)
      })
      .catch((e) => {
        if (!cancelled) fail(e)
      })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [])

  function fail(e: unknown) {
    const msg = e instanceof Error ? e.message : 'Không vào được cửa hàng'
    setError(msg)
    onError?.(msg)
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await fn() }
    catch (e) { fail(e) }
    finally { setBusy(false) }
  }

  async function done(id: string) {
    await connectCloud({ resume: true })
    markCloudShopEntered()
    onReady(id)
  }

  if (checking) {
    return (
      <div className="auth-form">
        <p className="auth-lead">Đang kiểm tra cửa hàng…</p>
      </div>
    )
  }

  return (
    <div className="auth-form">
      {shops.length > 0 && (
        <>
          <p className="auth-lead">Chọn cửa hàng đã có</p>
          {shops.map((shop) => (
            <button
              key={shop.shopId}
              type="button"
              className="auth-btn"
              data-busy={busy || undefined}
              disabled={busy}
              onClick={() => void withBusy(async () => { await done(await selectCloudShop(shop.shopId)) })}
            >
              {shop.name || shop.shopId}{shop.role ? ` · ${shop.role}` : ''}
            </button>
          ))}
          <p className="auth-or"><span>HOẶC</span></p>
        </>
      )}

      <button
        type="button"
        className="auth-btn auth-btn-pri"
        data-busy={busy || undefined}
        disabled={busy}
        onClick={() => void withBusy(async () => { await done(await createCloudShop()) })}
      >
        Tạo cửa hàng mới
      </button>

      <p className="auth-or"><span>HOẶC</span></p>

      <label className="auth-field">
        <span className="sr-only">Mã vào cửa hàng</span>
        <input
          className="auth-input"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          placeholder="Nhập mã để đăng nhập bằng tài khoản nhân viên"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || code.trim().length < 6) return
            void withBusy(async () => { await done(await redeemPairCode(code)) })
          }}
        />
      </label>
      <button
        type="button"
        className="auth-btn"
        data-busy={busy || undefined}
        disabled={busy || code.trim().length < 6}
        onClick={() => void withBusy(async () => { await done(await redeemPairCode(code)) })}
      >
        Vào cửa hàng
      </button>
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  )
}
