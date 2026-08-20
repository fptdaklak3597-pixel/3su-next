/** Vé đổi mật khẩu sau login — chỉ sống đến khi ghi session hoặc logout. */

let recentlyVerifiedUserId = ''

export function markRecentlyVerifiedUser(userId: string): void {
  recentlyVerifiedUserId = userId
}

export function forgetRecentlyVerifiedUser(): void {
  recentlyVerifiedUserId = ''
}

export function isRecentlyVerifiedUser(userId: string): boolean {
  return !!userId && recentlyVerifiedUserId === userId
}
