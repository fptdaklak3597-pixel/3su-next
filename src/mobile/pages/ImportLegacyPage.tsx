/**
 * Chuyển một lần từ file JSON xuất của 3SU cũ.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useApp } from '@/core/store'
import { importLegacy, previewLegacy, type LegacyChecksum } from '@/core/domain/migrate'
import { logError } from '@/core/errorLogger'

export function ImportLegacyPage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const [preview, setPreview] = useState<{ checksum: LegacyChecksum; data: ReturnType<typeof previewLegacy>['data'] } | null>(null)
  const [busy, setBusy] = useState(false)

  function onFile(f: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result))
        setPreview(previewLegacy(raw))
      } catch (e) {
        logError(e, 'migrate.preview')
        showToast(e instanceof Error ? e.message : 'File không đọc được', 'bad')
      }
    }
    reader.readAsText(f)
  }

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate(-1)}><ChevronLeft size={20} /></button>
        <div className="font-brand text-[17px] font-medium flex-1 text-center">Chuyển từ 3SU cũ</div>
        <div className="w-9" />
      </header>
      <div className="p-4 max-w-[520px] mx-auto w-full flex flex-col gap-3">
        <p className="text-sm" style={{ color: 'var(--mute)' }}>
          Chọn file JSON xuất đầy đủ từ 3SU v2.7.4. Chuyển một lần, không đồng bộ ngược về app cũ.
        </p>
        <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {preview && (
          <div className="card p-4 text-sm">
            <div>Sản phẩm: {preview.checksum.products}</div>
            <div>Đơn: {preview.checksum.sales}</div>
            <div>Khách: {preview.checksum.customers}</div>
            <div>Tổng tồn: {preview.checksum.stockSum}</div>
            <div>Tổng nợ: {preview.checksum.debtSum.toLocaleString('vi-VN')}đ</div>
            <button className="btn-cta mt-3" disabled={busy} onClick={() => {
              setBusy(true)
              importLegacy(preview.data).then((c) => {
                showToast(`Đã nhập ${c.products} SP, ${c.sales} đơn`, 'ok')
                navigate('/')
              }).catch((e) => {
                logError(e, 'migrate.import')
                showToast(e instanceof Error ? e.message : 'Lỗi nhập', 'bad')
              }).finally(() => setBusy(false))
            }}>Xác nhận nhập</button>
          </div>
        )}
      </div>
    </div>
  )
}
