/** Dev-only: xem UI không cần cloud. `?preview=1` giữ qua chuyển trang. */
const KEY = '3su_dev_ui_preview'

export function isDevUiPreview(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  try {
    const q = new URLSearchParams(window.location.search).get('preview')
    if (q === '1') {
      sessionStorage.setItem(KEY, '1')
      return true
    }
    if (q === '0') {
      sessionStorage.removeItem(KEY)
      return false
    }
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function enterDevUiPreview(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  sessionStorage.setItem(KEY, '1')
  const u = new URL(window.location.href)
  u.searchParams.set('preview', '1')
  window.location.assign(u.toString())
}
