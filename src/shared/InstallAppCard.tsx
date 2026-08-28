/**
 * 3SU Next — Ghim PWA ra màn hình
 * Android/Chrome: hộp thoại native. iPhone: sheet hướng dẫn Share.
 */
import { useState, type ReactNode } from 'react'
import { Home, Plus, Share, Smartphone } from 'lucide-react'
import { Sheet } from '@/shared/components'
import { installSurface, useDisplayMode, useInstallPrompt } from '@/shared/pwa'

function cardHint(surface: ReturnType<typeof installSurface>): string {
  if (surface === 'native') return 'Chạm để cài — mở như app'
  if (surface === 'ios-safari' || surface === 'ios-other') return 'Chạm để xem 3 bước trên Safari'
  return 'Chạm để xem cách cài'
}

function Step({ n, icon, children }: { n: number; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
        style={{ background: 'var(--paper-2)', color: 'var(--ink)' }}
      >
        {n}
      </div>
      <div className="flex-1 text-sm leading-snug" style={{ color: 'var(--ink)' }}>
        {icon ? (
          <span className="inline-flex items-start gap-1.5">
            <span className="shrink-0 mt-0.5" style={{ color: 'var(--gold)' }}>{icon}</span>
            <span>{children}</span>
          </span>
        ) : children}
      </div>
    </div>
  )
}

function GuideBody({ surface }: { surface: ReturnType<typeof installSurface> }) {
  if (surface === 'ios-safari') {
    return (
      <div className="flex flex-col gap-3 mb-5">
        <Step n={1} icon={<Share size={16} />}>Chạm nút Chia sẻ (ô có mũi tên lên) trên thanh Safari</Step>
        <Step n={2} icon={<Plus size={16} />}>Chọn <b>Thêm vào MH chính</b></Step>
        <Step n={3} icon={<Home size={16} />}>Chạm <b>Thêm</b> — lần sau mở 3SU như app</Step>
      </div>
    )
  }
  if (surface === 'ios-other') {
    return (
      <div className="flex flex-col gap-3 mb-5">
        <p className="text-sm" style={{ color: 'var(--ink)' }}>
          Ghim từ Chrome, Zalo hay Facebook sẽ mở lại trong trình duyệt. Mở <b>Safari</b> rồi vào{' '}
          <b>app.3su.shop</b>, sau đó:
        </p>
        <Step n={1} icon={<Share size={16} />}>Chạm nút Chia sẻ trên thanh Safari</Step>
        <Step n={2} icon={<Plus size={16} />}>Chọn <b>Thêm vào MH chính</b></Step>
        <Step n={3} icon={<Home size={16} />}>Chạm <b>Thêm</b></Step>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 mb-5">
      <Step n={1}>Mở trang này bằng <b>Chrome</b> (không phải Zalo / Facebook)</Step>
      <Step n={2}>Chạm menu <b>⋮</b> góc trên</Step>
      <Step n={3}>Chọn <b>Cài đặt ứng dụng</b> hoặc <b>Thêm vào màn hình chính</b></Step>
    </div>
  )
}

export function InstallAppCard({
  variant = 'mobile',
  className,
  title = 'Ghim ra màn hình',
}: {
  variant?: 'mobile' | 'web'
  className?: string
  title?: string
}) {
  const { canInstall, installed, promptInstall } = useInstallPrompt()
  const displayMode = useDisplayMode()
  const [guideOpen, setGuideOpen] = useState(false)
  const surface = installSurface(canInstall)

  if (displayMode === 'standalone' || installed) return null

  async function onTap() {
    if (canInstall) {
      try {
        await promptInstall()
      } catch {
        setGuideOpen(true)
      }
      return
    }
    setGuideOpen(true)
  }

  const hint = cardHint(surface)
  const sheet = (
    <Sheet open={guideOpen} onClose={() => setGuideOpen(false)} title="Ghim 3SU ra màn hình">
      <GuideBody surface={surface} />
      <button type="button" className={variant === 'web' ? 'web-btn pri' : 'btn-cta w-full'} onClick={() => setGuideOpen(false)}>
        Đã hiểu
      </button>
    </Sheet>
  )

  if (variant === 'web') {
    return (
      <>
        <div className={className ?? 'web-card'} style={className ? undefined : { marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 13.5 }}>{title}</h3>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--kv-muted)', lineHeight: 1.4 }}>{hint}</p>
          <button type="button" className="web-btn pri" onClick={() => void onTap()}>
            Cài đặt ứng dụng
          </button>
        </div>
        {sheet}
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        className={className ?? 'card w-full p-4 mt-3 flex items-center gap-3 text-left'}
        onClick={() => void onTap()}
      >
        <Smartphone size={20} style={{ color: 'var(--gold)' }} />
        <div>
          <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{title}</div>
          <div className="text-[11.5px]" style={{ color: 'var(--mute)' }}>{hint}</div>
        </div>
      </button>
      {sheet}
    </>
  )
}
