import { describe, expect, it } from 'vitest'
import { printResultToast } from '@/core/browser/printQueue'
import { printStatusLabel } from '@/core/browser/printLog'
import {
  countNegativeStock,
  shopGateFromEnterResult,
  shopHealthBanners,
  syncStatusBadge,
} from '@/core/domain/health-banners'

describe('shop gate cold-start', () => {
  it('timeout + đã có cloud:shopId local → vào app', () => {
    expect(shopGateFromEnterResult({
      enteredId: null, localShopId: 'shop_1', enterFailed: true,
    })).toBe('in')
  })

  it('timeout + chưa bind shop → màn join', () => {
    expect(shopGateFromEnterResult({
      enteredId: null, localShopId: null, enterFailed: true,
    })).toBe('need-shop')
  })

  it('server trả không shop → màn join dù local còn id cũ', () => {
    expect(shopGateFromEnterResult({
      enteredId: null, localShopId: 'shop_old', enterFailed: false,
    })).toBe('need-shop')
  })

  it('server trả shop → vào app', () => {
    expect(shopGateFromEnterResult({
      enteredId: 'shop_1', localShopId: null, enterFailed: false,
    })).toBe('in')
  })
})

describe('badge sync + tồn âm / lệch nợ', () => {
  it('pending khi online', () => {
    expect(syncStatusBadge({ online: true, pendingOps: 3, status: 'ok', poisoned: 0 }))
      .toEqual({ text: '3 lệnh chờ đồng bộ', tone: 'warn' })
  })

  it('poison hoặc error → đồng bộ kẹt', () => {
    expect(syncStatusBadge({ online: true, pendingOps: 0, status: 'error', poisoned: 0 })?.text)
      .toBe('Đồng bộ kẹt')
    expect(syncStatusBadge({ online: true, pendingOps: 0, status: 'ok', poisoned: 2 })?.to)
      .toBe('/cai-dat')
  })

  it('banner tồn âm và lệch nợ', () => {
    expect(countNegativeStock([{ stock: -1 }, { stock: 2, deleted: true }, { stock: 0 }])).toBe(1)
    expect(shopHealthBanners({ negativeStock: 2, debtDrifts: 1, debtTo: '/khach-hang' })).toEqual([
      { text: '2 mặt hàng tồn âm', to: '/kho' },
      { text: '1 khách lệch sổ nợ', to: '/khach-hang' },
    ])
  })
})

describe('print toast + log', () => {
  it('cloud/LAN không pretends đã in xong', () => {
    expect(printResultToast({ via: 'cloud' })).toEqual({
      text: 'Đã gửi lệnh in — kiểm tra máy tính',
      kind: '',
    })
    expect(printResultToast({ via: 'lan' }).kind).toBe('')
  })

  it('nhãn trạng thái in trên đơn', () => {
    expect(printStatusLabel(null)).toBe('Chưa gửi')
    expect(printStatusLabel({ via: 'cloud', at: 1 })).toBe('Đã gửi')
    expect(printStatusLabel({ via: 'none', at: 1, error: 'mất máy' })).toMatch(/Lỗi/)
  })
})
