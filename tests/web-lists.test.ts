/**
 * Lọc / phân trang web — giữ ổn định khi sửa UI.
 */
import { describe, it, expect } from 'vitest'
import { filterProducts, paginate, payLabel } from '@/web/lib/listFilters'
import type { Product } from '@/core/types'

function p(over: Partial<Product> & { name: string }): Product {
  return {
    id: over.id || over.name,
    cat: 'Khác',
    price: 10000,
    cost: 5000,
    stock: 10,
    unit: 'cái',
    barcode: '',
    expiry: '',
    units: [],
    wholesalePrice: 0,
    batches: [],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

describe('filterProducts', () => {
  const list = [
    p({ name: 'Gạo ST25', cat: 'Thực phẩm', barcode: 'GAO001', stock: 24 }),
    p({ name: 'Dầu ăn', cat: 'Thực phẩm', barcode: 'DAU003', stock: 2 }),
    p({ name: 'Sữa Ông Thọ', cat: 'Đồ uống', barcode: 'SUA012', stock: 0, expiry: '2026-08-20' }),
  ]

  it('lọc theo tên / mã', () => {
    expect(filterProducts(list, { query: 'gao', filter: 'all', cat: '', lowStock: 3, hsdWarnDays: 30 }).map((x) => x.name)).toEqual(['Gạo ST25'])
    expect(filterProducts(list, { query: 'DAU', filter: 'all', cat: '', lowStock: 3, hsdWarnDays: 30 }).map((x) => x.barcode)).toEqual(['DAU003'])
  })

  it('lọc tồn thấp / hết hàng', () => {
    expect(filterProducts(list, { query: '', filter: 'low', cat: '', lowStock: 3, hsdWarnDays: 30 }).map((x) => x.name)).toEqual(['Dầu ăn'])
    expect(filterProducts(list, { query: '', filter: 'out', cat: '', lowStock: 3, hsdWarnDays: 30 }).map((x) => x.name)).toEqual(['Sữa Ông Thọ'])
  })

  it('lọc nhóm', () => {
    expect(filterProducts(list, { query: '', filter: 'all', cat: 'Đồ uống', lowStock: 3, hsdWarnDays: 30 })).toHaveLength(1)
  })

  it('bỏ hàng đã xóa', () => {
    const gone = [...list, p({ name: 'Xóa', deleted: true })]
    expect(filterProducts(gone, { query: '', filter: 'all', cat: '', lowStock: 3, hsdWarnDays: 30 })).toHaveLength(3)
  })
})

describe('paginate', () => {
  const items = Array.from({ length: 16 }, (_, i) => i + 1)
  it('cắt 15/trang', () => {
    expect(paginate(items, 1, 15).rows).toHaveLength(15)
    expect(paginate(items, 2, 15).rows).toEqual([16])
    expect(paginate(items, 2, 15).pages).toBe(2)
  })
  it('kẹp trang ngoài biên', () => {
    expect(paginate(items, 99, 15).page).toBe(2)
    expect(paginate([], 1, 15).pages).toBe(1)
  })
})

describe('payLabel', () => {
  it('đổi mã thanh toán sang tiếng Việt', () => {
    expect(payLabel('cash')).toBe('Tiền mặt')
    expect(payLabel('debt')).toBe('Ghi nợ')
  })
})
