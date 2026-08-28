import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { restorePausedCopy } from '@/core/domain/trial'

export function RestorePausedBanner() {
  const navigate = useNavigate()
  const paused = useLiveQuery(() => dbx.meta.get('cloud:paused'), [])
  const last = useLiveQuery(() => dbx.meta.get('restore:last'), [])
  const text = restorePausedCopy(Boolean(paused?.value), last?.value ?? null)
  if (!text) return null
  return (
    <button
      type="button"
      className="w-full text-left rounded-xl px-3 py-2.5 mb-3 text-sm font-medium"
      style={{ background: 'rgba(158,74,62,.1)', color: 'var(--down)' }}
      onClick={() => navigate('/thiet-bi')}
    >
      {text}
    </button>
  )
}
