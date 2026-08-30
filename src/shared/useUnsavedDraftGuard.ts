import { createElement, useEffect, useRef, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'
import { ConfirmDialog } from '@/shared/components'

export function useUnsavedDraftGuard(dirty: boolean, allowPaths: string[] = []) {
  const skip = useRef(false)

  useEffect(() => {
    if (!dirty) return
    const onBefore = (e: BeforeUnloadEvent) => {
      if (skip.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [dirty])

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !skip.current
      && dirty
      && currentLocation.pathname !== nextLocation.pathname
      && !allowPaths.some((p) => nextLocation.pathname === p || nextLocation.pathname.startsWith(`${p}/`)),
  )

  const dialog: ReactNode = createElement(ConfirmDialog, {
    open: blocker.state === 'blocked',
    title: 'Rời trang?',
    message: 'Bản nháp chưa lưu sẽ mất nếu thoát. Bản trên máy vẫn giữ 24 giờ nếu đã ghi nháp.',
    confirmLabel: 'Rời trang',
    danger: true,
    onConfirm: () => blocker.proceed?.(),
    onCancel: () => blocker.reset?.(),
  })

  useEffect(() => {
    if (blocker.state !== 'blocked') skip.current = false
  }, [blocker.state])

  return {
    dialog,
    allowLeave() {
      skip.current = true
      if (blocker.state === 'blocked') blocker.proceed?.()
    },
  }
}
