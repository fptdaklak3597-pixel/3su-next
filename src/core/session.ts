import { liveQuery, type Subscription } from 'dexie'
import { getCurrentUser, normalizeCurrentUserSession } from './db'
import { logError } from './errorLogger'
import { useApp } from './store'
import type { User } from './types'

let subscription: Subscription | null = null

export function applyResolvedSessionUser(user: User | null): void {
  const current = useApp.getState().user
  if (current === user) return
  if (current?.id === user?.id
    && current?.hlc === user?.hlc
    && current?.updatedAt === user?.updatedAt
    && current?.active === user?.active
    && current?.deleted === user?.deleted
    && current?.role === user?.role
    && current?.passwordNeedsReset === user?.passwordNeedsReset
    && JSON.stringify(current?.perms ?? {}) === JSON.stringify(user?.perms ?? {})) {
    return
  }
  useApp.getState().setUser(user)
}

async function normalizeAndApply(): Promise<void> {
  try {
    applyResolvedSessionUser(await normalizeCurrentUserSession())
  } catch (error) {
    logError(error, 'session.normalize')
  }
}

/**
 * Theo dõi cả meta session lẫn record user. liveQuery chỉ đọc; migration/cleanup
 * chạy ở callback sau khi query kết thúc để không vi phạm Dexie read-only context.
 */
export function startCurrentUserSessionSync(): () => void {
  if (!subscription) {
    subscription = liveQuery(() => getCurrentUser()).subscribe({
      next: (user) => {
        applyResolvedSessionUser(user)
        void normalizeAndApply()
      },
      error: (error) => logError(error, 'session.live'),
    })
  }
  return stopCurrentUserSessionSync
}

export function stopCurrentUserSessionSync(): void {
  subscription?.unsubscribe()
  subscription = null
}
