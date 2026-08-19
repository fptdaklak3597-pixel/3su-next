import { describe, expect, it } from 'vitest'
import { foldVi, parsePrintTicket, saleTicketFromContext, testTicket, ticketToEscPos } from '@/core/browser/printTicket'
import { DEFAULT_SETTINGS, DEFAULT_SHOP } from '@/core/db'
import type { Sale } from '@/core/types'

const sale: Sale = {
  id: 's1',
  items: [{ productId: 'p1', name: 'Mì Hảo Hảo', qty: 2, price: 4000, cost: 3000, unit: 'gói', unitRatio: 1 }],
  total: 8000,
  profit: 2000,
  discount: 0,
  payMethod: 'cash',
  tendered: 10000,
  change: 2000,
  debtAmount: 0,
  customerId: null,
  date: '2026-08-16T01:00:00.000Z',
}

describe('print ticket', () => {
  it('dựng + parse phiếu bán', () => {
    const t = saleTicketFromContext({
      sale,
      shop: DEFAULT_SHOP,
      printer: DEFAULT_SETTINGS.printer,
      customerName: 'An',
      cashier: 'Thu',
    })
    expect(t.v).toBe(1)
    expect(t.kind).toBe('sale')
    expect(t.sale?.items[0].name).toBe('Mì Hảo Hảo')
    const again = parsePrintTicket(t)
    expect(again.sale?.id).toBe('s1')
  })

  it('từ chối HTML / kind lạ', () => {
    expect(() => parsePrintTicket({ v: 1, kind: 'html', shop: {} })).toThrow()
    expect(() => parsePrintTicket({ v: 2, kind: 'sale' })).toThrow()
  })

  it('ESC/POS có tên shop đã bỏ dấu + cắt giấy', () => {
    const t = testTicket('Cửa hàng 3SU', 58)
    const bytes = ticketToEscPos(t)
    const ascii = new TextDecoder().decode(bytes)
    expect(ascii).toContain('Cua hang 3SU')
    expect(bytes[bytes.length - 1]).toBe(0x00)
    expect(bytes[bytes.length - 2]).toBe(0x56)
  })

  it('foldVi', () => {
    expect(foldVi('Đắk Lắk')).toBe('Dak Lak')
  })
})
