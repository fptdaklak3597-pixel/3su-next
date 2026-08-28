import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { countNegativeStock, shopHealthBanners } from '@/core/domain/health-banners'
import { reconcileFrom } from '@/core/domain/reconcile'
import type { Customer, DebtPayment, Product, Sale, StockMove } from '@/core/types'

export function ShopHealthBanners({ debtTo = '/doi-soat' }: { debtTo?: string }) {
  const navigate = useNavigate()
  const products = useLiveQuery(() => dbx.products.toArray(), [], [] as Product[])
  const customers = useLiveQuery(() => dbx.customers.toArray(), [], [] as Customer[])
  const sales = useLiveQuery(() => dbx.sales.toArray(), [], [] as Sale[])
  const moves = useLiveQuery(() => dbx.stockMoves.toArray(), [], [] as StockMove[])
  const pays = useLiveQuery(() => dbx.debtPayments.toArray(), [], [] as DebtPayment[])

  const items = useMemo(() => {
    const debtDrifts = reconcileFrom(products, customers, sales, moves, pays).debtDrifts.length
    return shopHealthBanners({
      negativeStock: countNegativeStock(products),
      debtDrifts,
      debtTo,
    })
  }, [products, customers, sales, moves, pays, debtTo])

  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-2 mb-3">
      {items.map((it) => (
        <button
          key={it.to + it.text}
          type="button"
          className="w-full text-left rounded-xl px-3 py-2 text-sm font-medium"
          style={{ background: 'rgba(180,140,40,.12)', color: 'var(--ink)' }}
          onClick={() => navigate(it.to)}
        >
          {it.text}
        </button>
      ))}
    </div>
  )
}
