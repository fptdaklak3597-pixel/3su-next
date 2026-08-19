/**
 * Nạp 500 mặt hàng mẫu — chọn tồn ban đầu, xem nhóm. Dùng ở Kho và Tổng quan.
 */
import { useMemo, useState } from 'react'
import { seed500, seedCategories } from '@/core/domain/seed'
import { logError } from '@/core/errorLogger'
import { useApp } from '@/core/store'
import { Sheet } from '@/shared/components'

export function WebSeedSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const showToast = useApp((s) => s.showToast)
  const [seedStock, setSeedStock] = useState(0)
  const [seeding, setSeeding] = useState(false)
  const seedCats = useMemo(() => seedCategories(), [])

  async function handleSeed() {
    setSeeding(true)
    try {
      const res = await seed500(seedStock)
      showToast(`Đã thêm ${res.added} mặt hàng${res.skipped ? ` (${res.skipped} trùng)` : ''}`, 'ok')
      onClose()
    } catch (e) {
      logError(e, 'seed500')
      showToast('Lỗi khi nạp dữ liệu mẫu', 'bad')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Nạp 500 mặt hàng mẫu">
      <p className="web-sub" style={{ marginBottom: 10 }}>
        Danh mục tạp hoá phổ biến, giá tham khảo. Tên đã có thì bỏ qua.
      </p>
      <div className="web-seed-cats">
        {seedCats.map((c) => (
          <div key={c.cat} className="web-seed-cat">
            <span>{c.cat}</span>
            <b>{c.count}</b>
          </div>
        ))}
      </div>
      <label className="web-s-field" style={{ margin: '12px 0' }}>
        <span>Tồn kho ban đầu</span>
        <input
          className="web-input"
          type="number"
          min={0}
          value={seedStock || ''}
          placeholder="0"
          onChange={(e) => setSeedStock(Number(e.target.value) || 0)}
        />
      </label>
      <button type="button" className="web-btn pri w-full" disabled={seeding} onClick={() => void handleSeed()}>
        {seeding ? 'Đang nạp…' : 'Nạp 500 mặt hàng'}
      </button>
    </Sheet>
  )
}
