/**
 * Empty state lần đầu — nạp mẫu / thêm hàng / bán đơn.
 */
import type { ReactNode } from 'react'

export function WebEmpty({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children?: ReactNode
}) {
  return (
    <div className="web-empty">
      <h3>{title}</h3>
      {sub && <p>{sub}</p>}
      {children && <div className="web-ph-actions" style={{ justifyContent: 'center' }}>{children}</div>}
    </div>
  )
}
