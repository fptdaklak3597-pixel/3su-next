/**
 * Hệ quả công nợ khi hủy đơn: FIFO + phiếu dp_void_{saleId}.
 * Không đẩy debt.pay âm — apply từ chối số âm.
 */
import { dbx } from '../db'
import type { DebtPayment, Sale } from '../types'
import { allocateCustomerDebt, allocationForSale } from './debt-allocation'

export async function applySaleVoidDebtEffectsInTx(
  sale: Sale,
  opts: { adjustCustomer: boolean },
): Promise<number> {
  if (!sale.customerId) return 0
  const c = await dbx.customers.get(sale.customerId)
  if (!c) return 0

  let allocated = 0
  if (sale.debtAmount > 0) {
    const openSales = await dbx.sales
      .filter((s) => s.customerId === sale.customerId && (!s.voided || s.id === sale.id))
      .toArray()
    const forAlloc = openSales.map((s) => (s.id === sale.id ? { ...s, voided: false } : s))
    const pays = await dbx.debtPayments.where('customerId').equals(sale.customerId).toArray()
    const slice = allocationForSale(allocateCustomerDebt(forAlloc, pays, sale.customerId), sale.id)
    allocated = slice.allocated
    if (opts.adjustCustomer) c.debt = Math.max(0, c.debt - slice.unpaid)
    if (allocated > 0) {
      const dp: DebtPayment = {
        id: `dp_void_${sale.id}`,
        customerId: sale.customerId,
        amount: -allocated,
        date: new Date().toISOString(),
        note: 'Hoàn tiền do hủy đơn ' + sale.id.slice(-6),
      }
      if (!(await dbx.debtPayments.get(dp.id))) await dbx.debtPayments.add(dp)
    }
  }

  if (opts.adjustCustomer) {
    c.totalSpent = Math.max(0, c.totalSpent - sale.total)
    c.orderCount = Math.max(0, c.orderCount - 1)
    c.updatedAt = Date.now()
    await dbx.customers.put(c)
  }

  return allocated
}
