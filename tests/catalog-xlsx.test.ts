/**
 * Xuất/nhập danh mục — parse sheet + khớp mã/tên.
 */
import { describe, it, expect } from 'vitest'
import { matchCatalogTarget, parseCatalogSheet, type CatalogDraft } from '@/web/lib/catalogXlsx'
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

describe('parseCatalogSheet', () => {
  it('đọc header tiếng Việt', () => {
    const rows = parseCatalogSheet([
      ['Mã hàng', 'Tên hàng', 'Nhóm', 'Đơn vị', 'Giá bán', 'Giá vốn', 'Tồn'],
      ['GAO001', 'Gạo ST25', 'Thực phẩm', 'bao', '195.000', '160000', 20],
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      barcode: 'GAO001',
      name: 'Gạo ST25',
      cat: 'Thực phẩm',
      unit: 'bao',
      price: 195000,
      cost: 160000,
      stock: 20,
    })
  })

  it('bỏ dòng trống', () => {
    expect(parseCatalogSheet([
      ['name', 'price'],
      ['', ''],
      ['Dầu ăn', 25000],
    ]).map((r) => r.name)).toEqual(['Dầu ăn'])
  })

  it('sheet thiếu cột tên/mã → rỗng', () => {
    expect(parseCatalogSheet([['foo', 'bar'], ['a', 'b']])).toEqual([])
  })
})

describe('matchCatalogTarget', () => {
  const list = [
    p({ id: '1', name: 'Gạo ST25', barcode: 'GAO001' }),
    p({ id: '2', name: 'Dầu ăn', barcode: '' }),
  ]
  const draft = (over: Partial<CatalogDraft>): CatalogDraft => ({
    barcode: '', name: '', cat: '', unit: 'cái', price: 0, cost: 0, stock: 0, wholesalePrice: 0, expiry: '', ...over,
  })

  it('khớp mã trước tên', () => {
    expect(matchCatalogTarget(draft({ barcode: 'GAO001', name: 'Khác' }), list)?.id).toBe('1')
  })

  it('khớp tên khi không có mã', () => {
    expect(matchCatalogTarget(draft({ name: 'Dầu ăn' }), list)?.id).toBe('2')
  })

  it('không khớp hàng đã xóa', () => {
    expect(matchCatalogTarget(draft({ name: 'Cũ' }), [p({ name: 'Cũ', deleted: true })])).toBeUndefined()
  })
})
