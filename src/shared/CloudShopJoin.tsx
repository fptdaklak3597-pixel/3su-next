/**
 * Vào cửa hàng cloud: một Google = một cửa hàng.
 * Chủ chưa có shop thì tạo. Nhân viên vào bằng mã.
 * Máy còn sổ shop khác với tài khoản Google thì phải xuất sao lưu rồi xóa dữ liệu máy.
 */
import { useEffect, useState } from 'react'
import { exportBackup, wipeAll } from '@/core/db'
import { logError } from '@/core/errorLogger'
import {
  CloudTenantConflictError,
  connectCloud,
  createCloudShop,
  getCloudShopId,
  getDataShopId,
  googleHomeShop,
  listCloudShops,
  redeemPairCode,
  selectCloudShop,
  selectShopForSession,
} from '@/core/sync/cloud'
import { ConfirmDialog } from '@/shared/components'
import { markCloudShopEntered } from './useCloudSession'

const PENDING_ENTER_KEY = '3su:enterShopAfterWipe'

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
  const [boundShopId, setBoundShopId] = useState<string | null>(null)
  const [homeShopId, setHomeShopId] = useState<string | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [hasShops, setHasShops] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const pending = sessionStorage.getItem(PENDING_ENTER_KEY)
        if (pending) sessionStorage.removeItem(PENDING_ENTER_KEY)

        const [rows, bound, remembered] = await Promise.all([
          listCloudShops(),
          getDataShopId(),
          getCloudShopId(),
        ])
        if (cancelled) return
        setBoundShopId(bound)
        setHasShops(rows.length > 0)
        const home = googleHomeShop(rows)
        setHomeShopId(home?.shopId ?? null)

        if (pending && !bound) {
          if (pending === '__create__') {
            await afterBound(await createCloudShop())
            return
          }
          await finishEnter(pending)
          return
        }

        const selected = selectShopForSession(rows, remembered, bound)
        if (selected) {
          await finishEnter(selected.shopId)
          return
        }

        if (bound && home && bound !== home.shopId) {
          setError(
            `Máy này đang giữ sổ cửa hàng ${bound}, không khớp cửa hàng của tài khoản Google (${home.shopId}). Xuất sao lưu rồi xóa dữ liệu máy để vào đúng cửa hàng đó.`,
          )
        }
      } catch (e) {
        if (cancelled) return
        if (e instanceof CloudTenantConflictError) {
          setHomeShopId(e.requestedShopId)
          setError(e.message)
        } else fail(e)
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  function fail(e: unknown) {
    const msg = e instanceof Error ? e.message : 'Không vào được cửa hàng'
    setError(msg)
    onError?.(msg)
  }

  async function afterBound(shopId: string) {
    await connectCloud({ resume: true })
    markCloudShopEntered()
    onReady(shopId)
  }

  async function finishEnter(shopId: string) {
    await afterBound(await selectCloudShop(shopId))
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await fn() }
    catch (e) {
      if (e instanceof CloudTenantConflictError) {
        setHomeShopId(e.requestedShopId)
        setConfirmWipe(true)
        setError(e.message)
        return
      }
      fail(e)
    }
    finally { setBusy(false) }
  }

  async function handleExport() {
    try {
      const data = await exportBackup()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `3su-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      logError(e, 'join.export')
      fail(e)
    }
  }

  if (checking) {
    return (
      <div className="auth-form">
        <p className="auth-lead">Đang kiểm tra cửa hàng…</p>
      </div>
    )
  }

  const mismatch = !!boundShopId && !!homeShopId && boundShopId !== homeShopId

  return (
    <div className="auth-form">
      {!hasShops && (
        <button
          type="button"
          className="auth-btn auth-btn-pri"
          data-busy={busy || undefined}
          disabled={busy}
          onClick={() => void withBusy(async () => {
            if (boundShopId) {
              setConfirmWipe(true)
              return
            }
            await afterBound(await createCloudShop())
          })}
        >
          Tạo cửa hàng mới
        </button>
      )}

      {hasShops && homeShopId && (
        <button
          type="button"
          className="auth-btn auth-btn-pri"
          data-busy={busy || undefined}
          disabled={busy}
          onClick={() => void withBusy(async () => {
            if (mismatch) {
              setConfirmWipe(true)
              return
            }
            await finishEnter(homeShopId)
          })}
        >
          Vào cửa hàng
        </button>
      )}

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
            void withBusy(async () => { await afterBound(await redeemPairCode(code)) })
          }}
        />
      </label>
      <button
        type="button"
        className="auth-btn"
        data-busy={busy || undefined}
        disabled={busy || code.trim().length < 6}
        onClick={() => void withBusy(async () => { await afterBound(await redeemPairCode(code)) })}
      >
        Vào bằng mã nhân viên
      </button>

      {error && <p className="auth-error" role="alert">{error}</p>}

      {boundShopId && (
        <button type="button" className="auth-switch" onClick={() => void handleExport()}>
          Xuất sao lưu dữ liệu trên máy
        </button>
      )}

      <ConfirmDialog
        open={confirmWipe}
        title="Xóa dữ liệu máy để vào cửa hàng Google?"
        message={`Máy đang giữ sổ ${boundShopId}. Tài khoản Google dùng cửa hàng ${homeShopId ?? 'mới'}. Không trộn hai sổ. Hãy xuất sao lưu trước.`}
        confirmLabel="Xóa dữ liệu máy"
        danger
        onConfirm={() => {
          sessionStorage.setItem(PENDING_ENTER_KEY, homeShopId || '__create__')
          void wipeAll().then(() => window.location.reload())
        }}
        onCancel={() => setConfirmWipe(false)}
      />
    </div>
  )
}
