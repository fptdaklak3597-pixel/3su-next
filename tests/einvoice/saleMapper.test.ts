import { describe, expect, it } from 'vitest'
import { saleFromAuthoritativePayload } from '@/core/einvoice/saleMapper'

describe('saleFromAuthoritativePayload', () => {
  it('maps SaleCommitted payload to local Sale', () => {
    const sale = saleFromAuthoritativePayload({
      id: 'sale_1',
      items: [{
        productId: 'p1',
        name: 'A',
        qty: 2,
        unitName: 'chai',
        unitRatio: 1,
        price: 10000,
        cost: 4000,
      }],
      total: 20000,
      profit: 12000,
      discount: 0,
      payMethod: 'cash',
      debtAmount: 0,
      occurredAt: '2026-08-23T10:00:00.000Z',
    }, 20000)
    expect(sale.id).toBe('sale_1')
    expect(sale.total).toBe(20000)
    expect(sale.items[0].unit).toBe('chai')
    expect(sale.tendered).toBe(20000)
    expect(sale.synced).toBe(true)
  })
})
