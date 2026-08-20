import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/core/store'
import { saveSettingsSynced } from '@/core/domain/settings'
import {
  generateLanPrintSecret,
  getLanPrintSecret,
  isLoopbackLanAgentUrl,
  lanAgentNeedsSecret,
  normalizeLanAgentUrl,
  setLanPrintSecret,
  validateLanAgentConfiguration,
} from '@/core/browser/printAgentAuth'
import { tryLanPrint } from '@/core/browser/printQueue'
import { testTicket } from '@/core/browser/printTicket'
import { logError } from '@/core/errorLogger'

export function LanPrintAgentConfig() {
  const settings = useApp((state) => state.settings)
  const setSettings = useApp((state) => state.setSettings)
  const shop = useApp((state) => state.shop)
  const showToast = useApp((state) => state.showToast)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(settings.printer.lanAgentUrl || '')
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setUrl(settings.printer.lanAgentUrl || '')
    void getLanPrintSecret().then(setSecret).catch((error) => logError(error, 'print.lanSecret.read'))
  }, [open, settings.printer.lanAgentUrl])

  const normalizedPreview = useMemo(() => {
    try { return normalizeLanAgentUrl(url) } catch { return '' }
  }, [url])
  const needsSecret = normalizedPreview ? lanAgentNeedsSecret(normalizedPreview) : false

  async function save() {
    setBusy(true)
    try {
      const validated = await validateLanAgentConfiguration(url, secret)
      const next = {
        ...settings,
        printer: { ...settings.printer, lanAgentUrl: validated.url },
      }
      await setLanPrintSecret(validated.secret)
      await saveSettingsSynced(next)
      setSettings(next)
      setUrl(validated.url)
      setSecret(validated.secret)
      showToast(validated.url ? 'Đã lưu LAN Agent an toàn' : 'Đã tắt LAN Agent', 'ok')
    } catch (error) {
      logError(error, 'print.lanConfig.save')
      showToast(error instanceof Error ? error.message : 'Không lưu được LAN Agent', 'bad')
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    try {
      const validated = await validateLanAgentConfiguration(url, secret)
      if (!validated.url) throw new Error('Nhập địa chỉ LAN Agent trước')
      await setLanPrintSecret(validated.secret)
      const ok = await tryLanPrint(validated.url, testTicket(shop.name, settings.printer.width))
      if (!ok) throw new Error('Agent từ chối hoặc không phản hồi. Kiểm tra URL, secret và tường lửa.')
      showToast('Đã gửi phiếu thử tới LAN Agent', 'ok')
    } catch (error) {
      logError(error, 'print.lanConfig.test')
      showToast(error instanceof Error ? error.message : 'Không kết nối được LAN Agent', 'bad')
    } finally {
      setBusy(false)
    }
  }

  async function copyCommand() {
    try {
      const validated = await validateLanAgentConfiguration(url, secret)
      if (!validated.secret) throw new Error('Tạo hoặc nhập secret trước')
      const command = `PRINT_AGENT_LAN=1 PRINT_AGENT_SECRET=${JSON.stringify(validated.secret)} node scripts/print-agent.mjs`
      await navigator.clipboard.writeText(command)
      showToast('Đã chép lệnh chạy agent', 'ok')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Không chép được lệnh', 'bad')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', right: 16, bottom: 18, zIndex: 70,
          border: '1px solid var(--hair)', borderRadius: 999, padding: '10px 14px',
          background: 'var(--ink)', color: 'var(--paper)', fontWeight: 700,
          boxShadow: '0 8px 30px rgba(0,0,0,.2)',
        }}
      >
        LAN Agent
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cấu hình LAN Agent"
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,.48)', display: 'grid', placeItems: 'center', padding: 16,
          }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}
        >
          <div
            style={{
              width: 'min(520px, 100%)', maxHeight: '90vh', overflow: 'auto',
              borderRadius: 18, padding: 20, background: 'var(--paper)', color: 'var(--ink)',
              border: '1px solid var(--hair)', boxShadow: '0 24px 70px rgba(0,0,0,.35)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18 }}>LAN Print Agent</h3>
                <p style={{ margin: '6px 0 0', color: 'var(--mute)', fontSize: 13 }}>
                  Secret chỉ lưu trên thiết bị này, không sync và không nằm trong backup.
                </p>
              </div>
              <button type="button" className="web-btn btn-ghost" onClick={() => setOpen(false)}>Đóng</button>
            </div>

            <label style={{ display: 'grid', gap: 6, marginTop: 18 }}>
              <span style={{ fontSize: 12, color: 'var(--mute)' }}>Địa chỉ agent</span>
              <input
                className="field-input web-input"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="http://192.168.1.20:9101"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </label>

            <label style={{ display: 'grid', gap: 6, marginTop: 14 }}>
              <span style={{ fontSize: 12, color: 'var(--mute)' }}>
                Shared secret {needsSecret ? '(bắt buộc cho địa chỉ LAN)' : '(tùy chọn với localhost)'}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="field-input web-input"
                  style={{ flex: 1 }}
                  type={showSecret ? 'text' : 'password'}
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder="Tối thiểu 16 ký tự"
                  autoComplete="off"
                />
                <button type="button" className="web-btn btn-ghost" onClick={() => setShowSecret((value) => !value)}>
                  {showSecret ? 'Ẩn' : 'Hiện'}
                </button>
              </div>
            </label>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button type="button" className="web-btn btn-ghost" onClick={() => { setSecret(generateLanPrintSecret()); setShowSecret(true) }}>
                Tạo secret
              </button>
              <button type="button" className="web-btn btn-ghost" disabled={!secret} onClick={() => void copyCommand()}>
                Chép lệnh chạy agent
              </button>
            </div>

            <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: 'var(--paper-2)', fontSize: 12, color: 'var(--mute)' }}>
              <div>Agent mặc định chỉ nghe <code>127.0.0.1</code>.</div>
              <div style={{ marginTop: 4 }}>
                Muốn in từ máy khác trong Wi-Fi, chạy với <code>PRINT_AGENT_LAN=1</code> và cùng secret ở trên.
              </div>
              {normalizedPreview && (
                <div style={{ marginTop: 4 }}>
                  Chế độ: {isLoopbackLanAgentUrl(normalizedPreview) ? 'localhost' : 'LAN có HMAC'}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 18 }}>
              <button type="button" className="web-btn btn-ghost" disabled={busy} onClick={() => { setUrl(''); setSecret('') }}>
                Xóa cấu hình
              </button>
              <button type="button" className="web-btn btn-ghost" disabled={busy} onClick={() => void test()}>
                In thử LAN
              </button>
              <button type="button" className="web-btn pri btn-cta" disabled={busy} onClick={() => void save()}>
                {busy ? 'Đang lưu…' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
