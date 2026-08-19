const KEY = '3su:adminToken'
const USER_KEY = '3su:adminUser'

export function getAdminToken(): string {
  if (typeof sessionStorage === 'undefined') return ''
  return sessionStorage.getItem(KEY) || ''
}

export function getAdminUsername(): string {
  if (typeof sessionStorage === 'undefined') return ''
  return sessionStorage.getItem(USER_KEY) || 'admin'
}

export function setAdminSession(token: string, username: string): void {
  sessionStorage.setItem(KEY, token)
  sessionStorage.setItem(USER_KEY, username)
}

export function clearAdminSession(): void {
  sessionStorage.removeItem(KEY)
  sessionStorage.removeItem(USER_KEY)
}

export async function adminToken(): Promise<string> {
  const t = getAdminToken()
  if (!t) throw new Error('Chưa đăng nhập admin')
  return t
}
