/**
 * Đối soát sổ — tồn vs stockMoves, nợ vs đơn − thu. Chỉ đọc, không tự sửa.
 */
import { dbx } from '../db'
import type { Customer, Product, Sale, StockMove, DebtPayment } from '../types'

export interface StockDrift {
  productId: string
  name: string
  stock: number
  ledger: number
  drift: number
}

export interface DebtDrift {
  customerId: string
  name: string
  debt: number
  ledger: number
  drift: number
}

export interface ReconcileReport {
  at: number
  stockDrifts: StockDrift[]
  debtDrifts: DebtDrift[]
  stockOk: number
  debtOk: number
}

function ledgerStock(productId: string, moves: StockMove[]): number {
  return moves.filter((m) => m.productId === productId).reduce((a, m) => a + m.qty, 0)
}

function ledgerDebt(customerId: string, sales: Sale[], pays: DebtPayment[]): number {
  const fromSales = sales
    .filter((s) => !s.voided && s.customerId === customerId)
    .reduce((a, s) => a + (s.debtAmount || 0), 0)
  const paid = pays.filter((p) => p.customerId === customerId).reduce((a, p) => a + p.amount, 0)
  return fromSales - paid
}

export function reconcileFrom(
  products: Product[],
  customers: Customer[],
  sales: Sale[],
  moves: StockMove[],
  pays: DebtPayment[],
): ReconcileReport {
  const stockDrifts: StockDrift[] = []
  let stockOk = 0
  for (const p of products) {
    if (p.deleted) continue
    const ledger = ledgerStock(p.id, moves)
    const drift = Math.round((p.stock - ledger) * 1000) / 1000
    if (drift === 0) stockOk += 1
    else stockDrifts.push({ productId: p.id, name: p.name, stock: p.stock, ledger, drift })
  }

  const debtDrifts: DebtDrift[] = []
  let debtOk = 0
  for (const c of customers) {
    if (c.deleted) continue
    const ledger = ledgerDebt(c.id, sales, pays)
    const drift = Math.round((c.debt - ledger) * 1000) / 1000
    if (drift === 0) debtOk += 1
    else debtDrifts.push({ customerId: c.id, name: c.name, debt: c.debt, ledger, drift })
  }

  stockDrifts.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
  debtDrifts.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
  return { at: Date.now(), stockDrifts, debtDrifts, stockOk, debtOk }
}

export function explainStockDrift(d: StockDrift): string {
  if (d.drift > 0) return `Tồn máy nhiều hơn sổ ${d.drift} — thiếu phiếu xuất hoặc nhập tay không ghi sổ`
  return `Tồn máy ít hơn sổ ${-d.drift} — thiếu phiếu nhập hoặc kiểm kê chưa khớp`
}

export function explainDebtDrift(d: DebtDrift): string {
  if (d.drift > 0) return `Nợ máy cao hơn sổ ${d.drift} — thiếu phiếu thu hoặc đơn ghi nợ chưa vào sổ`
  return `Nợ máy thấp hơn sổ ${-d.drift} — thu thừa hoặc đơn nợ bị xóa khỏi sổ`
}

export async function reconcileBooks(): Promise<ReconcileReport> {
  const [products, customers, sales, moves, pays] = await Promise.all([
    dbx.products.toArray(),
    dbx.customers.toArray(),
    dbx.sales.toArray(),
    dbx.stockMoves.toArray(),
    dbx.debtPayments.toArray(),
  ])
  return reconcileFrom(products, customers, sales, moves, pays)
}
