import { describe, expect, it } from 'vitest'
import {
  compareInvoiceRows,
  filterInvoiceRows,
  invoicePeriodRange,
  invoiceSearchText,
  invoiceTotal,
  invoiceXmlState,
  visibleInvoiceRows,
} from '@/core/domain/invoices'
import { fillFromXml, renderInvoiceHtml } from '@/core/domain/invoiceGdtHtml'
import { invoiceSyncCaption } from '@/core/sync/invoicePageSync'
import { INVOICE_LINK_STALE_MS, invoiceLinkHealth } from '@/core/sync/invoiceLink'
import type { InvoiceRecord } from '@/core/types'
import type { InvoiceDeviceRow } from '@/core/sync/invoiceDevices'

function inv(over: Partial<InvoiceRecord> & Pick<InvoiceRecord, 'id' | 'code' | 'date'>): InvoiceRecord {
  return {
    type: 'gdt',
    amount: 100,
    tax: 10,
    status: 'issued',
    ts: 1,
    data: {},
    ...over,
  }
}

describe('danh sách hóa đơn Prime', () => {
  it('tổng ưu tiên số trên HĐ, không cộng lại tiền + thuế', () => {
    expect(invoiceTotal(inv({
      id: 'a', code: 'C-1', date: '2026-09-01',
      amount: 100, tax: 10, data: { total: 109 },
    }))).toBe(109)
    expect(invoiceTotal(inv({ id: 'b', code: 'C-2', date: '2026-09-01', amount: 100, tax: 10 }))).toBe(110)
  })

  it('tìm theo MST và số HĐ; xếp ngày mới trước', () => {
    const rows = [
      inv({
        id: 'old', code: 'AA-1', date: '2026-08-01', ts: 9,
        data: { sellerName: 'CTY A', nbmst: '0100123456', shdon: '1' },
      }),
      inv({
        id: 'new', code: 'BB-2', date: '2026-09-01', ts: 1,
        data: { sellerName: 'CTY B', nbmst: '0300987654', shdon: '2', hasXml: true },
      }),
    ]
    expect(invoiceSearchText(rows[0]!)).toContain('0100123456')
    expect(visibleInvoiceRows(rows, '0300987654', false).map((r) => r.id)).toEqual(['new'])
    expect(visibleInvoiceRows(rows, '', false).map((r) => r.id)).toEqual(['new', 'old'])
    expect(compareInvoiceRows(rows[0]!, rows[1]!)).toBeGreaterThan(0)
    expect(invoiceXmlState(rows[1]!)).toBe('có')
    expect(invoiceXmlState(rows[0]!)).toBe('chưa')
  })

  it('ẩn hóa đơn đã nhập kho khi lọc chưa nhập', () => {
    const rows = [
      inv({ id: 'open', code: 'A-1', date: '2026-09-01', data: {} }),
      inv({ id: 'done', code: 'A-2', date: '2026-09-01', data: { receiptId: 'gr1' } }),
    ]
    expect(visibleInvoiceRows(rows, '', true).map((r) => r.id)).toEqual(['open'])
  })

  it('chú thích đồng bộ khi đang kéo / đã kéo / lỗi', () => {
    expect(invoiceSyncCaption({ status: 'syncing', lastSyncAt: null, pendingOps: 0, error: null }))
      .toBe('Đang kéo hóa đơn từ máy…')
    expect(invoiceSyncCaption({ status: 'ok', lastSyncAt: null, pendingOps: 0, error: null }))
      .toBe('Chờ đồng bộ từ máy Invoice')
    expect(invoiceSyncCaption({ status: 'error', lastSyncAt: null, pendingOps: 0, error: 'timeout' }))
      .toBe('Đồng bộ lỗi: timeout')
    expect(invoiceSyncCaption({ status: 'offline', lastSyncAt: null, pendingOps: 0, error: null }))
      .toBe('Mất mạng — chưa kéo được hóa đơn từ máy')
  })

  it('lọc ngày, trạng thái, XML, đã nhập kho', () => {
    const rows = [
      inv({ id: 'aug', code: 'A-1', date: '2026-08-15', status: 'issued', data: { hasXml: true } }),
      inv({ id: 'sep', code: 'A-2', date: '2026-09-02', status: 'cancelled', data: { receiptId: 'gr1' } }),
    ]
    expect(filterInvoiceRows(rows, { query: '', from: '2026-09-01' }).map((r) => r.id)).toEqual(['sep'])
    expect(filterInvoiceRows(rows, { query: '', status: 'cancelled' }).map((r) => r.id)).toEqual(['sep'])
    expect(filterInvoiceRows(rows, { query: '', xml: 'yes' }).map((r) => r.id)).toEqual(['aug'])
    expect(filterInvoiceRows(rows, { query: '', stock: 'received' }).map((r) => r.id)).toEqual(['sep'])
    const month = invoicePeriodRange('month', '', '', new Date(2026, 8, 10))
    expect(month.from).toBe('2026-09-01')
    const last = invoicePeriodRange('lastMonth', '', '', new Date(2026, 8, 10))
    expect(last).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('tờ GDT lấy dòng hàng từ XML giống máy Invoice', () => {
    const xml = [
      '<HDon><DLHDon><TTChung><KHHDon>C26THH</KHHDon><SHDon>172438</SHDon><NLap>2026-08-30</NLap><THDon>Hóa đơn GTGT</THDon></TTChung>',
      '<NDHDon><NBan><Ten>CÔNG TY HẢI HÀ</Ten><MST>6000436830</MST><DChi>Buôn Hồ</DChi></NBan>',
      '<NMua><Ten>Hoàng Minh Chí</Ten><MST>046063006257</MST></NMua>',
      '<DSHHDVu><HHDVu><STT>1</STT><THHDVu>BM Socola - Nice 200g</THHDVu><DVTinh>Gói</DVTinh>',
      '<SLuong>144</SLuong><DGia>15741</DGia><TSuat>8%</TSuat><ThTien>1955504</ThTien>',
      '<TTKhac><TTin><TTruong>VATAmount</TTruong><DLieu>156440</DLieu></TTin></TTKhac></HHDVu></DSHHDVu>',
      '<TToan><TgTCThue>1955504</TgTCThue><TgTThue>156440</TgTThue><TgTTTBSo>2111944</TgTTTBSo></TToan>',
      '</NDHDon></DLHDon></HDon>',
    ].join('')
    const filled = fillFromXml({ khhdon: 'C26THH', shdon: '172438' }, xml)
    expect(filled.hdhhdvu?.[0]?.thhdvu).toBe('BM Socola - Nice 200g')
    expect(filled.nbten).toBe('CÔNG TY HẢI HÀ')
    const html = renderInvoiceHtml(filled, filled)
    expect(html).toContain('invoice-wrapper')
    expect(html).toContain('BM Socola - Nice 200g')
    expect(html).toContain('1.955.504')
    expect(html).toContain('Thông tin người bán hàng')
  })
})

function device(over: Partial<InvoiceDeviceRow>): InvoiceDeviceRow {
  return {
    deviceId: 'd1',
    uid: 'u1',
    status: 'active',
    scope: 'invoice',
    deviceName: 'Máy kế toán',
    createdAt: 1,
    rotatedAt: null,
    revokedAt: null,
    expiresAt: null,
    lastSeenAt: Date.now(),
    ...over,
  }
}

describe('cảnh báo máy 3SU Invoice', () => {
  const shop = { shopId: 'shop1', apiConfigured: true, devices: [] as InvoiceDeviceRow[] }

  it('chưa duyệt máy / mất heartbeat / cần đăng nhập thuế', () => {
    expect(invoiceLinkHealth({ ...shop, devices: [] }).kind).toBe('no_device')
    expect(invoiceLinkHealth({ ...shop, shopId: null }).kind).toBe('no_shop')
    expect(invoiceLinkHealth({
      ...shop,
      devices: [device({ lastSeenAt: Date.now() - INVOICE_LINK_STALE_MS - 1 })],
    }).kind).toBe('stale')
    expect(invoiceLinkHealth({
      ...shop,
      devices: [device({ gdtStatus: 'auth_required', lastSeenAt: Date.now() })],
    }).kind).toBe('gdt_auth')
    expect(invoiceLinkHealth({ ...shop, error: '500' }).kind).toBe('error')
    expect(invoiceLinkHealth({ ...shop, devices: [device({ lastSeenAt: Date.now() })] }).kind).toBe('ok')
  })
})
