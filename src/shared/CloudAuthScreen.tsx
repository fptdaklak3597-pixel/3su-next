/**
 * Màn đầu: đăng ký / đăng nhập cloud — chưa xong thì không vào app.
 * Nhịp bố cục lấy từ claude.ai/login; thương hiệu và copy là 3SU.
 */
import { useApp } from '@/core/store'
import { isFirebaseConfigured } from '@/core/sync/firebase'
import { apiBase } from '@/core/sync/cloud'
import { AuthStage } from './AuthStageArt'
import { WebCloudAuth } from './WebCloudAuth'
import { CloudShopJoin } from './CloudShopJoin'

export function AuthBootSplash() {
  return (
    <div className="auth-boot" role="status">
      <p>Đang mở cửa hàng…</p>
    </div>
  )
}

export function CloudAuthScreen() {
  const showToast = useApp((s) => s.showToast)
  const configured = isFirebaseConfigured() && !!apiBase()

  return (
    <div className="auth-screen">
      <div className="auth-logo">3SU</div>
      <div className="auth-layout">
        <div className="auth-col">
          <h1 className="auth-display">Bán hàng chưa bao giờ<br />dễ đến thế</h1>
          <div className="auth-well">
            {!configured ? (
              <p className="auth-lead">Chưa cấu hình máy chủ. Liên hệ người cài app.</p>
            ) : (
              <WebCloudAuth
                onReady={() => showToast('Đã vào cửa hàng', 'ok')}
                onError={(msg) => showToast(msg, 'bad')}
                onInfo={(msg) => showToast(msg, 'ok')}
              />
            )}
          </div>
        </div>
        <AuthStage />
      </div>
    </div>
  )
}

export function CloudShopJoinScreen() {
  const showToast = useApp((s) => s.showToast)

  return (
    <div className="auth-screen">
      <div className="auth-logo">3SU</div>
      <div className="auth-layout">
        <div className="auth-col">
          <h1 className="auth-display">Bán hàng chưa bao giờ<br />dễ đến thế</h1>
          <div className="auth-well">
            <CloudShopJoin
              onReady={() => showToast('Đã vào cửa hàng', 'ok')}
              onError={(msg) => showToast(msg, 'bad')}
            />
          </div>
        </div>
        <AuthStage />
      </div>
    </div>
  )
}
