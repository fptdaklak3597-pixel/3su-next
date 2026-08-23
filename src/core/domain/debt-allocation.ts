/**
 * Phân bổ thu nợ FIFO lên các đơn ghi nợ còn mở (cùng khách).
 * Dùng khi hủy đơn để biết phần chưa thu (trừ nợ) vs phần đã thu (hoàn tiền).
 */
export interface DebtAllocation {
  saleId: string
  debtAmount: number
  allocated: number
  unpaid: number
}

export function allocateCustomerDebt(
  sales: Array<{ id: string; customerId?: string | null; debtAmount?: number; voided?: boolean; date: string }>,
  payments: Array<{ amount: number }>,
  customerId: string,
): DebtAllocation[] {
  const open = sales
    .filter((s) => !s.voided && s.customerId === customerId && (s.debtAmount ?? 0) > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))

  // Chỉ cộng khoản thu dương; phiếu hoàn (âm) không đưa vào pool phân bổ.
  let pool = payments.reduce((a, p) => a + (Number.isFinite(p.amount) && p.amount > 0 ? Math.round(p.amount) : 0), 0)
  const out: DebtAllocation[] = []
  for (const s of open) {
    const debtAmount = Math.round(s.debtAmount ?? 0)
    const allocated = Math.min(debtAmount, pool)
    pool -= allocated
    out.push({ saleId: s.id, debtAmount, allocated, unpaid: debtAmount - allocated })
  }
  return out
}

export function allocationForSale(
  alloc: DebtAllocation[],
  saleId: string,
): { allocated: number; unpaid: number; debtAmount: number } {
  const hit = alloc.find((a) => a.saleId === saleId)
  if (hit) return hit
  return { allocated: 0, unpaid: 0, debtAmount: 0 }
}
