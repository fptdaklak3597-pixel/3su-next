/**
 * Phân biệt hai app: web (khung KiotViet) và mobile (3SU v2.7.4).
 * `__APP_NAME__` do Vite inject theo `--mode`.
 */
export type AppShell = 'web' | 'mobile'

export function appShell(): AppShell {
  return typeof __APP_NAME__ === 'string' && __APP_NAME__ === 'mobile' ? 'mobile' : 'web'
}

export function isWebShell(): boolean {
  return appShell() === 'web'
}

export function setAppShell(shell: AppShell = appShell()): void {
  document.documentElement.setAttribute('data-shell', shell)
}
