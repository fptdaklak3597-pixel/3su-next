/**
 * Xuất/nhập danh mục — parse sheet + khớp mã/tên.
 */
import { describe, it, expect } from 'vitest'
import {
  CATALOG_HEADERS,
  catalogExportRows,
  formatUnitsCell,
  matchCatalogTarget,
  parseCatalogSheet,
  parseUnitsCell,
  type CatalogDraft,
} from '@/web/lib/catalogXlsx'
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
    barcode: '', name: '', cat: '', unit: 'cái', price: 0, cost: 0, stock: 0, wholesalePrice: 0, expiry: '', units: null, ...over,
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

describe('quy đổi + mã vạch', () => {
  it('format / parse quy đổi thùng=24, lốc=6', () => {
    expect(formatUnitsCell([{ n: 'thùng', r: 24 }, { n: 'lốc', r: 6 }])).toBe('thùng=24, lốc=6')
    expect(parseUnitsCell('thùng=24, lốc=6')).toEqual([{ n: 'thùng', r: 24 }, { n: 'lốc', r: 6 }])
    expect(parseUnitsCell('1 thùng = 24; lốc x 6')).toEqual([{ n: 'thùng', r: 24 }, { n: 'lốc', r: 6 }])
    expect(parseUnitsCell('')).toBeNull()
    expect(parseUnitsCell('abc')).toBeNull()
  })

  it('đọc header Mã vạch + Quy đổi; file cũ 9 cột vẫn đọc được', () => {
    const neu = parseCatalogSheet([
      ['Mã hàng', 'Tên hàng', 'Nhóm', 'Đơn vị', 'Giá bán', 'Giá vốn', 'Tồn', 'Giá sỉ', 'HSD', 'Quy đổi', 'Mã vạch'],
      ['', 'Coca 390ml', 'Nước ngọt', 'chai', 10000, 7000, 48, 0, '', 'thùng=24, lốc=6', '8934588012220'],
    ])
    expect(neu[0]).toMatchObject({
      name: 'Coca 390ml',
      barcode: '8934588012220',
      units: [{ n: 'thùng', r: 24 }, { n: 'lốc', r: 6 }],
    })

    const cu = parseCatalogSheet([
      ['Mã hàng', 'Tên hàng', 'Nhóm', 'Đơn vị', 'Giá bán', 'Giá vốn', 'Tồn', 'Giá sỉ', 'HSD'],
      ['GAO001', 'Gạo ST25', 'Thực phẩm', 'bao', 195000, 160000, 20, 0, ''],
    ])
    expect(cu[0]).toMatchObject({ barcode: 'GAO001', name: 'Gạo ST25', units: null })
  })

  it('Mã vạch trống không đè Mã hàng', () => {
    const rows = parseCatalogSheet([
      ['Mã hàng', 'Tên hàng', 'Mã vạch'],
      ['GAO001', 'Gạo ST25', ''],
    ])
    expect(rows[0].barcode).toBe('GAO001')
  })

  it('xuất đủ 11 cột, mã vạch lặp lại, quy đổi ghi thùng=24', () => {
    expect(CATALOG_HEADERS).toEqual([
      'Mã hàng', 'Tên hàng', 'Nhóm', 'Đơn vị', 'Giá bán', 'Giá vốn', 'Tồn', 'Giá sỉ', 'HSD', 'Quy đổi', 'Mã vạch',
    ])
    const rows = catalogExportRows([
      p({ barcode: '893', name: 'Coca', units: [{ n: 'thùng', r: 24 }] }),
    ])
    expect(rows[0]).toEqual([...CATALOG_HEADERS])
    expect(rows[1]).toEqual(['893', 'Coca', 'Khác', 'cái', 10000, 5000, 10, 0, '', 'thùng=24', '893'])
  })
})
