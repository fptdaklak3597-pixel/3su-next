/**
 * Chuyển một lần từ JSON 3SU cũ — khung web.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/core/store'
import { importLegacy, previewLegacy, type LegacyChecksum } from '@/core/domain/migrate'
import { logError } from '@/core/errorLogger'

export function WebImportLegacyPage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const [preview, setPreview] = useState<{ checksum: LegacyChecksum; data: ReturnType<typeof previewLegacy>['data'] } | null>(null)
  const [busy, setBusy] = useState(false)

  function onFile(f: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        setPreview(previewLegacy(JSON.parse(String(reader.result))))
      } catch (e) {
        logError(e, 'migrate.preview')
        showToast(e instanceof Error ? e.message : 'File không đọc được', 'bad')
      }
    }
    reader.readAsText(f)
  }

  return (
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>Chuyển từ 3SU cũ</h2>
          <p>File JSON xuất đầy đủ từ v2.7.4 — một lần, không đồng bộ ngược.</p>
        </div>
        <button className="web-btn" onClick={() => navigate('/cai-dat')}>Cài đặt</button>
      </div>
      <div className="web-card" style={{ maxWidth: 560 }}>
        <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {preview && (
          <div className="text-sm mt-3">
            <div>Sản phẩm: {preview.checksum.products}</div>
            <div>Đơn: {preview.checksum.sales}</div>
            <div>Khách: {preview.checksum.customers}</div>
            <div>Tổng tồn: {preview.checksum.stockSum}</div>
            <div>Tổng nợ: {preview.checksum.debtSum.toLocaleString('vi-VN')}đ</div>
            <button
              className="web-btn pri mt-3"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                importLegacy(preview.data).then((c) => {
                  showToast(`Đã nhập ${c.products} SP, ${c.sales} đơn`, 'ok')
                  navigate('/')
                }).catch((e) => {
                  logError(e, 'migrate.import')
                  showToast(e instanceof Error ? e.message : 'Lỗi nhập', 'bad')
                }).finally(() => setBusy(false))
              }}
            >
              Xác nhận nhập
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
