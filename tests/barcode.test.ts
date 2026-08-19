import { describe, expect, it } from 'vitest'
import { barcodeVariants, findProductByBarcode, normalizeBarcode, verifyBarcodeChecksum } from '@/core/browser/barcode'
import type { Product } from '@/core/types'

function p(over: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Coca',
    cat: 'Nước',
    price: 10000,
    cost: 7000,
    stock: 10,
    unit: 'lon',
    barcode: '8934588012220',
    expiry: '',
    units: [],
    wholesalePrice: 0,
    batches: [],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

describe('barcode variants', () => {
  it('chuẩn hoá bỏ gạch và khoảng', () => {
    expect(normalizeBarcode(' 893-4588_012220 ')).toBe('8934588012220')
  })

  it('UPC-A ↔ EAN-13 leading zero', () => {
    const upc = barcodeVariants('123456789012')
    expect(upc).toContain('123456789012')
    expect(upc).toContain('0123456789012')
    const ean = barcodeVariants('0123456789012')
    expect(ean).toContain('123456789012')
  })

  it('tìm SP khi máy quét thêm số 0', () => {
    const products = [p({ barcode: '123456789012' })]
    expect(findProductByBarcode('0123456789012', products)?.id).toBe('p1')
    expect(findProductByBarcode('123456789012', products)?.id).toBe('p1')
  })

  it('checksum EAN-13', () => {
    expect(verifyBarcodeChecksum('0000000000000')).toBe(true)
    expect(verifyBarcodeChecksum('0000000000001')).toBe(false)
    expect(verifyBarcodeChecksum('ABC123')).toBe(true)
  })
})
