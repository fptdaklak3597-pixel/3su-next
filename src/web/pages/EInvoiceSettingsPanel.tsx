/**
 * HĐĐT — readiness + profile (Phase 6 minimal UI).
 */
import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { useApp } from '@/core/store'
import { setMeta } from '@/core/db'
import { apiBase, getCloudShopId } from '@/core/sync/cloud'
import {
  fetchEinvoiceReadiness,
  upsertEinvoiceProfile,
  type EinvoiceReadiness,
} from '@/core/einvoice/sdk'
import {
  isAuthoritativeMoneyStockEnabled,
  setAuthoritativeMoneyStockEnabled,
} from '@/core/authoritative/flag'

export function EInvoiceSettingsPanel() {
  const showToast = useApp((s) => s.showToast)
  const [ready, setReady] = useState<EinvoiceReadiness | null>(null)
  const [loading, setLoading] = useState(false)
  const [authOn, setAuthOn] = useState(false)
  const [voluntary, setVoluntary] = useState(false)
  const [cqtOk, setCqtOk] = useState(false)
  const [autoIssue, setAutoIssue] = useState(false)
  const [series, setSeries] = useState('2C26TAA')
  const [cloudOk, setCloudOk] = useState(false)

  useEffect(() => {
    void (async () => {
      const on = await isAuthoritativeMoneyStockEnabled()
      setAuthOn(on)
      const base = apiBase()
      const shopId = await getCloudShopId()
      setCloudOk(!!base && !!shopId)
      if (!base || !shopId) return
      try {
        const r = await fetchEinvoiceReadiness()
        setReady(r)
      } catch {
        setReady(null)
      }
    })()
  }, [])

  async function handleSaveProfile() {
    setLoading(true)
    try {
      await upsertEinvoiceProfile({
        voluntaryEnabled: voluntary,
        cqtRegistrationAccepted: cqtOk,
        autoIssue,
        selectedSeries: series.trim() || undefined,
      })
      await setMeta('einvoice:autoIssue', autoIssue)
      const r = await fetchEinvoiceReadiness()
      setReady(r)
      showToast('✓ Đã lưu hồ sơ HĐĐT', 'ok')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Lỗi lưu hồ sơ', 'bad')
    } finally {
      setLoading(false)
    }
  }

  async function toggleAuthoritative(on: boolean) {
    try {
      await setAuthoritativeMoneyStockEnabled(on)
      setAuthOn(on)
      showToast(on ? 'Bật chốt sổ authoritative' : 'Tắt authoritative — dùng local', 'ok')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Không bật được', 'bad')
    }
  }

  return (
    <div className="web-settings-block">
      <div className="web-settings-block-t">
        <FileText size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
        Hóa đơn điện tử (HĐĐT)
      </div>
      {!cloudOk && (
        <p className="web-sub">Cần đăng nhập cloud và chọn cửa hàng trước khi thiết lập HĐĐT.</p>
      )}
      {cloudOk && ready && (
        <p className="web-sub">
          Sẵn sàng xuất HĐĐT: <strong>{ready.ready ? 'Có' : 'Chưa'}</strong>
          {ready.checks.filter((c) => !c.ok).map((c) => (
            <span key={c.key} style={{ display: 'block' }}>— {c.message || c.key}</span>
          ))}
        </p>
      )}
      <label className="web-s-field">
        <span>Ký hiệu hóa đơn (series)</span>
        <input className="web-input" value={series} onChange={(e) => setSeries(e.target.value)} />
      </label>
      <label className="web-s-check">
        <input type="checkbox" checked={cqtOk} onChange={(e) => setCqtOk(e.target.checked)} />
        Tờ khai đã được CQT chấp nhận
      </label>
      <label className="web-s-check">
        <input type="checkbox" checked={voluntary} onChange={(e) => setVoluntary(e.target.checked)} />
        Kích hoạt xuất HĐĐT (tự nguyện / bắt buộc)
      </label>
      <label className="web-s-check">
        <input type="checkbox" checked={autoIssue} onChange={(e) => setAutoIssue(e.target.checked)} />
        Tự xuất HĐĐT sau mỗi đơn (khi compliance yêu cầu)
      </label>
      <p className="web-sub">Xuất sau khi chốt đơn thành công, khi có mạng. Lỗi HĐĐT không hủy đơn.</p>
      <label className="web-s-check">
        <input type="checkbox" checked={authOn} onChange={(e) => toggleAuthoritative(e.target.checked)} />
        Chốt sổ authoritative (dev/staging — cần cho HĐĐT production)
      </label>
      <div className="web-settings-actions">
        <button type="button" className="web-btn pri" disabled={loading || !cloudOk} onClick={() => void handleSaveProfile()}>
          Lưu hồ sơ HĐĐT
        </button>
      </div>
    </div>
  )
}
