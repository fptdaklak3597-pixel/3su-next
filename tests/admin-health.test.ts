import { describe, expect, it } from 'vitest'
import {
  filterFleet,
  isExpiringSoon,
  licenseBar,
  matchesSearch,
  shopAlertReasons,
  shopHealth,
  usageHeatmap14,
  vnDay,
} from '@/admin/health'
import { fmtSession, type AdminShop } from '@/admin/api'

const NOW = Date.parse('2026-08-19T08:00:00+07:00')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function shop(partial: Partial<AdminShop>): AdminShop {
  return {
    shopId: 'shop_1',
    name: 'Quán Phở',
    phone: '0903',
    address: '',
    ownerUid: 'u1',
    ownerEmail: 'lan@gmail.com',
    status: 'active',
    plan: 'basic',
    expiresAt: NOW + 30 * DAY,
    lockedReason: '',
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW,
    lastOpAt: NOW - 10 * 60 * 1000,
    todaySeconds: 0,
    ...partial,
  }
}

describe('shopHealth', () => {
  it('locked wins over a fresh lastOp', () => {
    expect(shopHealth(shop({ status: 'locked', lastOpAt: NOW - 1000 }), NOW)).toBe('khoá')
  })

  it('sống when last op is under 1 hour', () => {
    expect(shopHealth(shop({ lastOpAt: NOW - HOUR + 1 }), NOW)).toBe('sống')
  })

  it('chậm when last op is under 24 hours', () => {
    expect(shopHealth(shop({ lastOpAt: NOW - 2 * HOUR }), NOW)).toBe('chậm')
  })

  it('offline when last op is missing or older than 24 hours', () => {
    expect(shopHealth(shop({ lastOpAt: NOW - 25 * HOUR }), NOW)).toBe('offline')
    expect(shopHealth(shop({ lastOpAt: null }), NOW)).toBe('offline')
  })
})

describe('isExpiringSoon', () => {
  it('is true at 0 and 7 days left, false at 8, expired, locked, or unlimited', () => {
    expect(isExpiringSoon(shop({ expiresAt: NOW }), NOW)).toBe(true)
    expect(isExpiringSoon(shop({ expiresAt: NOW + 7 * DAY }), NOW)).toBe(true)
    expect(isExpiringSoon(shop({ expiresAt: NOW + 8 * DAY }), NOW)).toBe(false)
    expect(isExpiringSoon(shop({ expiresAt: NOW - 1 }), NOW)).toBe(false)
    expect(isExpiringSoon(shop({ status: 'locked', expiresAt: NOW + DAY }), NOW)).toBe(false)
    expect(isExpiringSoon(shop({ expiresAt: null }), NOW)).toBe(false)
  })
})

describe('shopAlertReasons', () => {
  it('stacks locked, expired, expiring, and stale sync', () => {
    expect(shopAlertReasons(shop({ status: 'locked', lastOpAt: NOW }), NOW)).toEqual(['locked'])
    expect(shopAlertReasons(shop({ status: 'expired', lastOpAt: NOW }), NOW)).toEqual(['expired'])
    expect(shopAlertReasons(shop({ status: 'trial', expiresAt: NOW + 3 * DAY, lastOpAt: NOW }), NOW)).toEqual(['expiring'])
    expect(shopAlertReasons(shop({ lastOpAt: NOW - 48 * HOUR, expiresAt: NOW + 30 * DAY }), NOW)).toEqual(['sync_stale'])
    expect(shopAlertReasons(shop({ lastOpAt: null, expiresAt: NOW + 30 * DAY }), NOW)).toEqual(['sync_stale'])
  })
})

describe('licenseBar', () => {
  it('unlimited has no fill', () => {
    expect(licenseBar(shop({ createdAt: NOW - 10 * DAY, expiresAt: null }), NOW)).toMatchObject({
      unlimited: true,
      usedDays: 10,
      totalDays: 0,
      leftDays: null,
      fill: 0,
    })
  })

  it('computes used / total / left and fill', () => {
    const bar = licenseBar(shop({ createdAt: NOW - 148 * DAY, expiresAt: NOW + 32 * DAY }), NOW)
    expect(bar.unlimited).toBe(false)
    expect(bar.usedDays).toBe(148)
    expect(bar.totalDays).toBe(180)
    expect(bar.leftDays).toBe(32)
    expect(bar.fill).toBeCloseTo(148 / 180)
  })
})

describe('usageHeatmap14', () => {
  it('returns 14 VN days, oldest first, missing days as 0', () => {
    const today = vnDay(NOW)
    const cells = usageHeatmap14([{ day: today, seconds: 3600 }], NOW)
    expect(cells).toHaveLength(14)
    expect(cells[13]).toEqual({ day: today, seconds: 3600 })
    expect(cells[0].seconds).toBe(0)
    expect(cells[0].day < today).toBe(true)
  })
})

describe('fmtSession', () => {
  it('labels today vs another VN day', () => {
    expect(fmtSession(NOW, NOW + 90 * 60 * 1000, vnDay(NOW))).toBe('Hôm nay · 08:00 – 09:30')
    expect(fmtSession(NOW - DAY, NOW - DAY + 45 * 60 * 1000, vnDay(NOW))).toMatch(/^18\/08 · /)
  })
})

describe('filterFleet', () => {
  it('AND-combines search and health filter', () => {
    const rows = [
      shop({ shopId: 'shop_a', name: 'Phở', lastOpAt: NOW - 1000 }),
      shop({ shopId: 'shop_b', name: 'Tạp hóa', lastOpAt: NOW - 2 * HOUR, ownerEmail: 'an@x.com' }),
    ]
    expect(filterFleet(rows, 'phở', 'all', NOW).map((s) => s.shopId)).toEqual(['shop_a'])
    expect(filterFleet(rows, '', 'chậm', NOW).map((s) => s.shopId)).toEqual(['shop_b'])
    expect(matchesSearch(rows[1], 'an@x')).toBe(true)
  })
})
