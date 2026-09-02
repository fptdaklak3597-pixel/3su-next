/**
 * 3SU Next — Test các module bổ sung (f4/f5/f13)
 *  - inventory: detectPriceSpike, liveBatchExpiry, suggestSellPrice
 *  - notes: sortNotes
 *  - invoiceImport: numVN, dateISO, csvParse, rowsToItems, parseEInvoiceXML
 *  - units: convertPriceByUnit, breakdownQty
 *  - pricing: applyPricingRule
 *
 * Chạy: `npm run test`
 */
import { describe, it, expect } from 'vitest'
import { detectPriceSpike, liveBatchExpiry, suggestSellPrice } from '@/core/domain/inventory'
import { sortNotes } from '@/core/domain/notes'
import { numVN, dateISO, csvParse, rowsToItems, parseEInvoiceXML } from '@/core/domain/invoiceImport'
import { convertPriceByUnit, breakdownQty } from '@/core/domain/units'
import { applyPricingRule } from '@/core/domain/pricing'
import type { PriceLogEntry, ProductBatch, Note, PricingRule } from '@/core/types'

/* ─── inventory ─── */
describe('detectPriceSpike', () => {
  const hist = (costs: number[]): PriceLogEntry[] =>
    costs.map((cost, i) => ({ id: 'pl' + i, productId: 'p1', supId: 's1', supName: 'S', cost, ts: i }))

  it('trả về null khi ít hơn 2 bản ghi', () => {
    expect(detectPriceSpike(hist([1000]), 2000)).toBeNull()
  })

  it('trả về null khi giá trong ngưỡng', () => {
    expect(detectPriceSpike(hist([1000, 1000, 1000]), 1100)).toBeNull()
  })

  it('phát hiện giá tăng > 15%', () => {
    const pct = detectPriceSpike(hist([1000, 1000, 1000]), 1500)
    expect(pct).toBe(50)
  })
})

describe('liveBatchExpiry', () => {
  const batch = (remain: number, expiry: string): ProductBatch =>
    ({ id: 'b', qty: remain, remain, cost: 1000, expiry, date: '2026-01-01' })

  it('trả về HSD sớm nhất trong các lô còn hàng', () => {
    expect(liveBatchExpiry([batch(5, '2026-12-01'), batch(3, '2026-06-01')])).toBe('2026-06-01')
  })

  it('bỏ qua lô hết hàng', () => {
    expect(liveBatchExpiry([batch(0, '2026-01-01'), batch(2, '2026-09-01')])).toBe('2026-09-01')
  })

  it('rỗng khi không còn lô nào', () => {
    expect(liveBatchExpiry([batch(0, '2026-01-01')])).toBe('')
  })
})

describe('suggestSellPrice', () => {
  it('gợi ý margin 20% khi giá hiện tại thấp', () => {
    const r = suggestSellPrice(10000, 0)
    expect(r?.price).toBe(12000)
    expect(r?.margin).toBe(20)
  })

  it('không gợi ý khi giá hiện tại đã đủ lời', () => {
    expect(suggestSellPrice(10000, 12000)).toBeNull()
  })
})

/* ─── notes ─── */
describe('sortNotes', () => {
  const note = (over: Partial<Note>): Note =>
    ({ id: 'n', text: 'x', date: '2026-01-01T00:00:00Z', type: 'note', done: false, pinned: false, ...over })

  it('ghim lên đầu, chưa xong trước, mới trước', () => {
    const a = note({ id: 'a', date: '2026-01-01T00:00:00Z' })
    const b = note({ id: 'b', date: '2026-01-02T00:00:00Z' })
    const c = note({ id: 'c', pinned: true, date: '2026-01-01T00:00:00Z' })
    const d = note({ id: 'd', done: true, date: '2026-01-03T00:00:00Z' })
    const sorted = sortNotes([a, b, c, d]).map((n) => n.id)
    expect(sorted).toEqual(['c', 'b', 'a', 'd'])
  })
})

/* ─── invoiceImport ─── */
describe('numVN', () => {
  it('parse số kiểu Việt Nam (dấu chấm phân cách)', () => {
    expect(numVN('1.234.567')).toBe(1234567)
  })
  it('parse số có chữ đ và khoảng trắng', () => {
    expect(numVN(' 45.000 đ ')).toBe(45000)
  })
  it('số thường', () => {
    expect(numVN(8000)).toBe(8000)
  })
})

describe('dateISO', () => {
  it('chuyển dd/mm/yyyy → ISO', () => {
    expect(dateISO('15/03/2026')).toBe('2026-03-15')
  })
  it('giữ nguyên ISO', () => {
    expect(dateISO('2026-03-15')).toBe('2026-03-15')
  })
})

describe('csvParse + rowsToItems', () => {
  it('parse CSV có quote', () => {
    const rows = csvParse('a,"b,c",d\n1,2,3')
    expect(rows).toEqual([['a', 'b,c', 'd'], ['1', '2', '3']])
  })

  it('đọc dòng sản phẩm từ bảng', () => {
    const rows = [
      ['Tên hàng', 'SL', 'Đơn giá', 'Thành tiền'],
      ['Mì Hảo Hảo', '10', '3.500', '35.000'],
    ]
    const items = rowsToItems(rows)
    expect(items.length).toBe(1)
    expect(items[0].name).toBe('Mì Hảo Hảo')
    expect(items[0].qty).toBe(10)
    expect(items[0].cost).toBe(3500)
  })
})

describe('parseEInvoiceXML', () => {
  it('đọc nhà cung cấp + mặt hàng từ XML hóa đơn điện tử', () => {
    const xml = `<?xml version="1.0"?>
<DLHDon>
  <NBan><Ten>Công ty ABC</Ten><MST>0123456789</MST></NBan>
  <NLap>2026-03-15</NLap>
  <DSHHDVu>
    <HHDVu><THHDVu>Mì Hảo Hảo</THHDVu><SLuong>5</SLuong><DGia>3500</DGia><DVTinh>gói</DVTinh><ThTien>17500</ThTien></HHDVu>
  </DSHHDVu>
  <TgTTTBSo>17500</TgTTTBSo>
</DLHDon>`
    const inv = parseEInvoiceXML(xml)
    expect(inv.supplier.name).toContain('ABC')
    expect(inv.supplier.mst).toBe('0123456789')
    expect(inv.items.length).toBe(1)
    expect(inv.items[0].qty).toBe(5)
    expect(inv.items[0].cost).toBe(3500)
  })
})

describe('invoice draft from desktop xml', () => {
  it('giữ sourceInvoiceId khi dựng draft', async () => {
    const { persistInvoiceDraft, loadFreshDraft, DRAFT_INVOICE, clearDraft } = await import('@/core/domain/drafts')
    await persistInvoiceDraft({
      inv: { supplier: { name: 'CTY A' }, items: [], date: '2026-09-01' },
      rows: [],
      supName: 'CTY A',
      supId: '',
      date: '2026-09-01',
      expiry: '',
      paid: 0,
      payMethod: 'cash',
      sourceInvoiceId: 'inv_gdt_abc',
    })
    const loaded = await loadFreshDraft<{ sourceInvoiceId?: string }>(DRAFT_INVOICE)
    expect(loaded?.sourceInvoiceId).toBe('inv_gdt_abc')
    await clearDraft(DRAFT_INVOICE)
  })
})

/* ─── units ─── */
describe('units', () => {
  it('nhân giá theo tỷ lệ', () => {
    expect(convertPriceByUnit(5000, { n: 'thùng', r: 24 })).toBe(120000)
  })
  it('phân rã số lượng theo đơn vị lớn trước', () => {
    const bd = breakdownQty(50, [{ n: 'cái', r: 1 }, { n: 'chục', r: 10 }])
    expect(bd['chục']).toBe(5)
  })
})

/* ─── pricing ─── */
describe('applyPricingRule', () => {
  const rule: PricingRule = { id: 'r1', name: 'R', cat: '', marginPct: 25, roundTo: 1000, active: true }
  it('tính giá theo biên lợi nhuận + làm tròn', () => {
    // 8000 * 1.25 = 10000, tròn 1000 → 10000
    expect(applyPricingRule(8000, rule)).toBe(10000)
  })
  it('vốn 0 → giá 0', () => {
    expect(applyPricingRule(0, rule)).toBe(0)
  })
})
