/**
 * Tài khoản cloud — đăng nhập, vào cửa hàng bằng mã, tạo mã cho máy mới.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '@/core/store'
import { logError } from '@/core/errorLogger'
import { textQrSrc } from '@/core/browser/textQr'
import {
  cloudSignOut,
  getFirebaseAuth,
  isCloudEmailPending,
  watchCloudUser,
} from '@/core/sync/firebase'
import {
  connectCloud,
  createPairCode,
  enterExistingCloudShop,
  getCloudRole,
  getCloudShopId,
} from '@/core/sync/cloud'
import { useCloudSession } from '@/shared/useCloudSession'
import { WebCloudAuth } from '@/shared/WebCloudAuth'
import { CloudShopJoin } from '@/shared/CloudShopJoin'
import type { User as FirebaseUser } from 'firebase/auth'

export function WebAccountPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const showToast = useApp((s) => s.showToast)
  const setUser = useApp((s) => s.setUser)
  const shop = useApp((s) => s.shop)
  const cloudSession = useCloudSession()
  const [cloudUser, setCloudUser] = useState<FirebaseUser | null>(
    () => getFirebaseAuth()?.currentUser ?? null,
  )
  const [shopId, setShopId] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [shopBusy, setShopBusy] = useState(false)
  const [pairCode, setPairCode] = useState('')
  const [pairUntil, setPairUntil] = useState(0)
  const next = params.get('next') || ''

  useEffect(() => {
    return watchCloudUser((u) => {
      setCloudUser(u)
      if (!u || isCloudEmailPending(u)) {
        setShopId(null)
        setRole(null)
        return
      }
      setShopBusy(true)
      void enterExistingCloudShop()
        .then(async (id) => {
          setShopId(id)
          setRole(id ? await getCloudRole() : null)
        })
        .catch((e) => {
          logError(e, 'account.ensureShop')
          setShopId(null)
          setRole(null)
        })
        .finally(() => setShopBusy(false))
    })
  }, [])

  useEffect(() => {
    if (cloudUser && shopId && next.startsWith('/')) navigate(next)
  }, [cloudUser, shopId, next, navigate])

  const signedIn = !!cloudUser && !isCloudEmailPending(cloudUser)
  const inShop = signedIn && !!shopId
  const isOwner = role === 'owner'
  const showLoginForm = cloudSession === 'out' && !signedIn

  const leftSec = pairUntil > Date.now() ? Math.max(1, Math.ceil((pairUntil - Date.now()) / 1000)) : 0
  const who = signedIn
    ? [cloudUser!.email, isOwner ? 'Chủ' : inShop ? 'Nhân viên' : null, inShop ? shop.name : null].filter(Boolean).join(' · ')
    : cloudSession === 'loading' ? 'Đang mở…' : 'Chưa đăng nhập'

  return (
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>Tài khoản</h2>
          <p>{who}</p>
        </div>
      </div>

      <div className="web-hub">
        <div className="web-card">
          {signedIn ? (
            <>
              {!inShop && !shopBusy && (
                <CloudShopJoin
                  onReady={(id) => {
                    setShopId(id)
                    void getCloudRole().then(setRole)
                    showToast('Đã vào cửa hàng', 'ok')
                  }}
                  onError={(msg) => showToast(msg, 'bad')}
                />
              )}

              {inShop && isOwner && (
                <div>
                  <div className="web-settings-block-t">Mã mời</div>
                  <p className="web-sub" style={{ marginTop: 6 }}>Máy mới hoặc nhân viên quét / nhập mã này.</p>
                  <div className="web-settings-actions" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="web-btn pri"
                      disabled={shopBusy}
                      onClick={() => {
                        setShopBusy(true)
                        void createPairCode()
                          .then((r) => {
                            setPairCode(r.code)
                            setPairUntil(r.expiresAt)
                            showToast('Đã tạo mã', 'ok')
                          })
                          .catch((e) => showToast(e instanceof Error ? e.message : 'Không tạo được mã', 'bad'))
                          .finally(() => setShopBusy(false))
                      }}
                    >
                      Tạo mã
                    </button>
                  </div>
                  {pairCode && (
                    <div style={{ marginTop: 16, textAlign: 'center' }}>
                      <div className="stat-num" style={{ fontSize: 28, letterSpacing: '0.3em' }}>{pairCode}</div>
                      <p className="web-sub">
                        {leftSec > 0 ? `Còn ${leftSec} giây` : 'Hết hạn, tạo mã mới'}
                      </p>
                      <img src={textQrSrc(pairCode)} alt="QR mã mời" style={{ margin: '12px auto 0', maxWidth: 140, borderRadius: 8 }} />
                    </div>
                  )}
                </div>
              )}

              <div className="web-settings-actions" style={{ marginTop: inShop && isOwner ? 16 : 0 }}>
                <button type="button" className="web-btn" onClick={() => navigate('/cai-dat')}>Cài đặt</button>
                <button
                  type="button"
                  className="web-btn"
                  onClick={async () => {
                    await cloudSignOut()
                    setUser(null)
                    setShopId(null)
                    setRole(null)
                    setPairCode('')
                    showToast('Đã đăng xuất', 'ok')
                    navigate('/')
                  }}
                >
                  Đăng xuất
                </button>
              </div>
            </>
          ) : cloudSession === 'loading' ? (
            <p className="web-sub">Đang mở…</p>
          ) : showLoginForm ? (
            <WebCloudAuth
              embed
              onReady={async (id) => {
                setShopId(id || null)
                setRole(await getCloudRole())
                try { await connectCloud({ resume: true }) } catch (e) { logError(e, 'account.connect') }
                showToast(id ? 'Đã vào tài khoản' : 'Đăng nhập xong', 'ok')
                if (id && next.startsWith('/')) navigate(next)
              }}
              onError={(msg) => showToast(msg, 'bad')}
              onInfo={(msg) => showToast(msg, 'ok')}
            />
          ) : (
            <p className="web-sub">Đang mở…</p>
          )}
        </div>
      </div>
    </div>
  )
}
