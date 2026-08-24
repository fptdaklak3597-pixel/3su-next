/**
 * AI settings — Gemini BYOK (write-only on server).
 */
import { useEffect, useState } from 'react'
import { Bot, ExternalLink } from 'lucide-react'
import { deleteGeminiApiKey, fetchAiStatus, saveGeminiApiKey, type AiStatus } from '@/core/ai/client'
import { useApp } from '@/core/store'
import { apiBase } from '@/core/sync/cloud'

export function AiSettingsPanel({ variant = 'web' }: { variant?: 'web' | 'mobile' }) {
  const showToast = useApp((s) => s.showToast)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const cloudOk = !!apiBase()

  useEffect(() => {
    if (!cloudOk) return
    void fetchAiStatus()
      .then(setStatus)
      .catch((e) => {
        setStatus(null)
        showToast(e instanceof Error ? e.message : 'Không tải được trạng thái AI', 'bad')
      })
  }, [cloudOk])

  const fieldClass = variant === 'web' ? 'web-input' : 'input'
  const blockClass = variant === 'web' ? 'web-settings-block' : 'card p-4 space-y-3'
  const titleClass = variant === 'web' ? 'web-settings-block-t' : 'font-semibold text-sm flex items-center gap-2'

  if (!cloudOk) {
    return (
      <div className={blockClass}>
        <div className={titleClass}><Bot size={16} /> Trợ lý AI</div>
        <p className={variant === 'web' ? 'web-sub' : 'text-sm text-muted'}>Bật đồng bộ cloud để dùng AI.</p>
      </div>
    )
  }

  async function handleSaveKey() {
    if (!apiKey.trim()) { showToast('Nhập API key', 'bad'); return }
    setBusy(true)
    try {
      await saveGeminiApiKey(apiKey.trim())
      setApiKey('')
      const s = await fetchAiStatus()
      setStatus(s)
      showToast('✓ Đã lưu & kiểm tra key Gemini', 'ok')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Lỗi lưu key', 'bad')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteKey() {
    setBusy(true)
    try {
      await deleteGeminiApiKey()
      const s = await fetchAiStatus()
      setStatus(s)
      showToast('Đã xóa key Gemini', 'ok')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Lỗi', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={blockClass}>
      <div className={titleClass}><Bot size={16} /> Trợ lý AI</div>
      <p className={variant === 'web' ? 'web-sub' : 'text-sm text-muted'}>
        Mặc định dùng Workers AI (miễn phí). Kết nối Gemini để quét hoá đơn chất lượng cao hơn.
        {status && ` Hôm nay: ${status.usageToday}/${status.quotaLimit} lượt.`}
      </p>
      <p className={variant === 'web' ? 'web-sub' : 'text-sm text-muted'}>
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
          Lấy API key Google AI Studio <ExternalLink size={12} />
        </a>
      </p>
      {status?.hasGeminiKey ? (
        <div className={variant === 'web' ? 'web-settings-actions' : 'flex gap-2'}>
          <span className={variant === 'web' ? 'web-sub' : 'text-sm text-green-700'}>✓ Gemini đã kết nối</span>
          <button type="button" className={variant === 'web' ? 'web-btn' : 'btn btn-ghost btn-sm'} disabled={busy} onClick={() => void handleDeleteKey()}>
            Xóa key
          </button>
        </div>
      ) : (
        <>
          <label className={variant === 'web' ? 'web-s-field' : 'block'}>
            <span>API key Gemini</span>
            <input
              className={fieldClass}
              type="password"
              placeholder="AIza…"
              value={apiKey}
              disabled={busy}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <div className={variant === 'web' ? 'web-settings-actions' : 'flex gap-2'}>
            <button type="button" className={variant === 'web' ? 'web-btn pri' : 'btn btn-primary btn-sm'} disabled={busy} onClick={() => void handleSaveKey()}>
              Lưu & kiểm tra
            </button>
          </div>
        </>
      )}
    </div>
  )
}
