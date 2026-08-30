/**
 * Màn đầu: đăng ký / đăng nhập cloud — chưa xong thì không vào app.
 * Nhịp bố cục lấy từ claude.ai/login; thương hiệu và copy là 3SU.
 */
import { useApp } from '@/core/store'
import { enterDevUiPreview } from '@/core/devPreview'
import { cloudSignOut, isFirebaseConfigured } from '@/core/sync/firebase'
import { AuthStage } from './AuthStageArt'
import { WebCloudAuth } from './WebCloudAuth'
import { CloudShopJoin } from './CloudShopJoin'
import { CloudVerifyEmail } from './CloudVerifyEmail'
import { markCloudNeedShop, markCloudShopEntered } from './useCloudSession'

export function AuthBootSplash({ message }: { message?: string } = {}) {
  return (
    <div className="auth-boot" role="status">
      <p>{message ?? 'Đang mở cửa hàng…'}</p>
    </div>
  )
}

export function DevPreviewEnter() {
  if (!import.meta.env.DEV) return null
  return (
    <button type="button" className="auth-btn" style={{ marginTop: 16 }} onClick={() => enterDevUiPreview()}>
      Xem cửa hàng trên máy này
    </button>
  )
}

export function CloudAuthScreen() {
  const showToast = useApp((s) => s.showToast)
  const configured = isFirebaseConfigured()

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
            <DevPreviewEnter />
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
            <DevPreviewEnter />
          </div>
        </div>
      </div>
    </div>
  )
}


export function CloudVerifyEmailScreen() {
  const showToast = useApp((s) => s.showToast)
  return (
    <div className="auth-screen">
      <div className="auth-logo">3SU</div>
      <div className="auth-layout">
        <div className="auth-col">
          <h1 className="auth-display">Bán hàng chưa bao giờ<br />dễ đến thế</h1>
          <div className="auth-well">
            <CloudVerifyEmail
              onReady={(shopId) => {
                if (shopId) markCloudShopEntered()
                else markCloudNeedShop()
              }}
              onError={(msg) => showToast(msg, 'bad')}
              onInfo={(msg) => showToast(msg, 'ok')}
              onBack={() => { void cloudSignOut() }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
