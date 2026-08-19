import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { listAdminShops, type AdminShop } from './api'
import { shopAlertReasons } from './health'

type AdminData = {
  shops: AdminShop[]
  busy: boolean
  err: string
  q: string
  setQ: (q: string) => void
  reload: () => Promise<void>
  alertCount: number
}

const Ctx = createContext<AdminData | null>(null)

export function AdminStore({ children }: { children: ReactNode }) {
  const [shops, setShops] = useState<AdminShop[]>([])
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')

  const reload = useCallback(async () => {
    setBusy(true)
    try {
      const rows = await listAdminShops()
      setShops(rows)
      setErr('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lỗi tải')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const value = useMemo<AdminData>(() => ({
    shops,
    busy,
    err,
    q,
    setQ,
    reload,
    alertCount: shops.filter((s) => shopAlertReasons(s).length > 0).length,
  }), [shops, busy, err, q, reload])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAdminStore(): AdminData {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAdminStore outside AdminStore')
  return ctx
}
