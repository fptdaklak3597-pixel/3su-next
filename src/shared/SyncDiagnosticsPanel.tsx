/**
 * Hiển thị op sync bị kẹt (blocked) / bỏ qua (poisoned) + nút bỏ qua blocked.
 */
import { useCallback, useEffect, useState } from 'react'
import { getBlockedOps, getPoisonedOps, skipBlockedOp, type BlockedOp, type PoisonedOp } from '@/core/sync/apply'
import { logError } from '@/core/errorLogger'
import { useApp } from '@/core/store'

export function SyncDiagnosticsPanel({ variant = 'web' }: { variant?: 'web' | 'mobile' }) {
  const showToast = useApp((s) => s.showToast)
  const [blocked, setBlocked] = useState<BlockedOp[]>([])
  const [poisoned, setPoisoned] = useState<PoisonedOp[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([getBlockedOps(), getPoisonedOps()])
      setBlocked(b)
      setPoisoned(p)
    } catch (e) {
      logError(e, 'sync.diagnostics')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 8000)
    return () => window.clearInterval(t)
  }, [refresh])

  async function onSkip(id: string) {
    setBusyId(id)
    try {
      const ok = await skipBlockedOp(id)
      showToast(ok ? 'Đã bỏ qua op bị kẹt' : 'Không tìm thấy op', ok ? 'ok' : 'bad')
      await refresh()
    } catch (e) {
      logError(e, 'sync.skipBlocked')
      showToast('Không bỏ qua được', 'bad')
    } finally {
      setBusyId(null)
    }
  }

  if (blocked.length === 0 && poisoned.length === 0) {
    return (
      <p className={variant === 'web' ? 'web-sub' : 'text-xs'} style={variant === 'mobile' ? { color: 'var(--mute)' } : undefined}>
        Không có op đồng bộ bị kẹt hoặc đã bỏ qua gần đây.
      </p>
    )
  }

  return (
    <div className={variant === 'web' ? 'web-settings-block' : 'flex flex-col gap-2'}>
      {blocked.length > 0 && (
        <>
          <div className={variant === 'web' ? 'web-settings-block-t' : 'text-xs font-semibold'}>
            Đang chờ dependency ({blocked.length})
          </div>
          <ul className={variant === 'web' ? 'web-sub' : 'text-xs'} style={{ margin: 0, paddingLeft: 16 }}>
            {blocked.map((b) => (
              <li key={b.id} style={{ marginBottom: 8 }}>
                <code>{b.type}</code> — {b.message}
                <div style={{ marginTop: 4 }}>
                  <button
                    type="button"
                    className={variant === 'web' ? 'web-btn' : 'btn-ghost text-xs'}
                    disabled={busyId === b.id}
                    onClick={() => void onSkip(b.id)}
                  >
                    {busyId === b.id ? '…' : 'Bỏ qua'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {poisoned.length > 0 && (
        <>
          <div className={variant === 'web' ? 'web-settings-block-t' : 'text-xs font-semibold'} style={{ marginTop: 8 }}>
            Đã bỏ qua / poison ({poisoned.length})
          </div>
          <ul className={variant === 'web' ? 'web-sub' : 'text-xs'} style={{ margin: 0, paddingLeft: 16 }}>
            {poisoned.slice(-10).map((p) => (
              <li key={p.id} style={{ marginBottom: 4 }}>
                <code>{p.type}</code> — {p.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
