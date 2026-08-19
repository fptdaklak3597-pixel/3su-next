import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { filterFleet, type FleetFilter } from './health'
import { ShopTable } from './ShopTable'
import { useAdminStore } from './store'

const FILTERS: Array<{ id: FleetFilter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'sống', label: 'Sống' },
  { id: 'chậm', label: 'Chậm' },
  { id: 'offline', label: 'Offline' },
  { id: 'khoá', label: 'Khoá' },
  { id: 'expiring', label: 'Sắp hết' },
]

export function ShopList() {
  const { shops, busy, err, q, reload } = useAdminStore()
  const [params] = useSearchParams()
  const search = q || params.get('q') || ''
  const [filter, setFilter] = useState<FleetFilter>('all')
  const rows = useMemo(() => filterFleet(shops, search, filter), [shops, search, filter])
  const counts = useMemo(() => ({
    all: filterFleet(shops, search, 'all').length,
    sống: filterFleet(shops, search, 'sống').length,
    chậm: filterFleet(shops, search, 'chậm').length,
    offline: filterFleet(shops, search, 'offline').length,
    khoá: filterFleet(shops, search, 'khoá').length,
    expiring: filterFleet(shops, search, 'expiring').length,
  }), [shops, search])

  return (
    <div className="admin-page">
      <header className="admin-toolbar">
        <h1 className="admin-title">Đội cửa hàng</h1>
        <button type="button" className="admin-refresh" disabled={busy} onClick={() => void reload()}>
          Làm mới
        </button>
      </header>
      <div className="admin-filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={filter === f.id ? 'is-on' : ''}
            onClick={() => setFilter(f.id)}
          >
            {f.label} <span>{counts[f.id]}</span>
          </button>
        ))}
      </div>
      {err && <p className="admin-err">{err}</p>}
      <ShopTable shops={rows} empty={busy ? 'Đang tải…' : 'Không có shop'} />
    </div>
  )
}
