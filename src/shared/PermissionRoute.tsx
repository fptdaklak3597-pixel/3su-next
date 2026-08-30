import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { isDevUiPreview } from '@/core/devPreview'
import { canAccessFeature } from '@/core/domain/access'
import type { UserPerms } from '@/core/types'

export function PermissionRoute({ permission }: { permission: keyof UserPerms }) {
  const user = useApp((s) => s.user)
  const showToast = useApp((s) => s.showToast)
  const location = useLocation()
  const userRecordCount = useLiveQuery(() => dbx.users.count(), [])
  const devPreview = isDevUiPreview()

  const ready = userRecordCount !== undefined
  const allowed = ready && canAccessFeature(user, permission, userRecordCount, devPreview)

  useEffect(() => {
    if (ready && !allowed) showToast('Bạn không có quyền mở mục này', 'bad')
  }, [allowed, ready, showToast, location.pathname])

  if (!ready) return null
  if (!allowed) return <Navigate to="/" replace state={{ deniedFrom: location.pathname }} />
  return <Outlet />
}
