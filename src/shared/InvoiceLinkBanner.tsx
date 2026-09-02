import { useNavigate } from 'react-router-dom'
import type { InvoiceLinkHealth } from '@/core/sync/invoiceLink'

export function InvoiceLinkBanner({ health }: { health: InvoiceLinkHealth | null }) {
  const navigate = useNavigate()
  if (!health || health.kind === 'ok') return null
  return (
    <button
      type="button"
      className={`inv-link-banner ${health.tone}`}
      onClick={() => health.to && navigate(health.to)}
    >
      {health.text}
    </button>
  )
}
