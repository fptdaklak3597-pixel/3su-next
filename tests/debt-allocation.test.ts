import { describe, it, expect } from 'vitest'
import { allocateCustomerDebt, allocationForSale } from '@/core/domain/debt-allocation'

describe('allocateCustomerDebt FIFO', () => {
  it('phân bổ thu nợ theo đơn cũ trước', () => {
    const alloc = allocateCustomerDebt(
      [
        { id: 'a', customerId: 'c1', debtAmount: 50, date: '2026-01-01', voided: false },
        { id: 'b', customerId: 'c1', debtAmount: 50, date: '2026-01-02', voided: false },
      ],
      [{ amount: 50 }],
      'c1',
    )
    expect(allocationForSale(alloc, 'a')).toMatchObject({ allocated: 50, unpaid: 0 })
    expect(allocationForSale(alloc, 'b')).toMatchObject({ allocated: 0, unpaid: 50 })
  })

  it('hủy đơn đã thu → refund = allocated, unpaid = 0', () => {
    const alloc = allocateCustomerDebt(
      [{ id: 'a', customerId: 'c1', debtAmount: 100, date: '2026-01-01', voided: false }],
      [{ amount: 100 }],
      'c1',
    )
    expect(allocationForSale(alloc, 'a')).toMatchObject({ allocated: 100, unpaid: 0 })
  })
})
