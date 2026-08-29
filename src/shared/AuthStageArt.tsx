/**
 * Panel auth — video reveal: bàn tay nắm → mở cửa tiệm mini.
 * Thông điệp: "cả cửa hàng, gọn trong tay bạn".
 */
import { useEffect, useRef } from 'react'

export function AuthStage() {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.muted = true
    void el.play().catch(() => {
      /* autoplay bị chặn thì poster vẫn hiện; lần tương tác sau trình duyệt tự phát */
    })
  }, [])

  return (
    <div className="auth-stage" aria-hidden="true">
      <img
        className="auth-stage-poster"
        src="/hero-v4-poster.webp"
        alt=""
        draggable={false}
      />
      <video
        ref={videoRef}
        className="auth-stage-video"
        src="/hero-v4.mp4"
        poster="/hero-v4-poster.webp"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />
    </div>
  )
}
