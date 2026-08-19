import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from '@/core/db'
import { payQrSrc, vietQrFromSettings, vietQrImageUrl } from '@/core/domain/vietqr'

describe('vietqr', () => {
  it('ghép URL img.vietqr.io với amount + addInfo', () => {
    const url = vietQrImageUrl({
      bankId: 'VCB',
      accountNo: '012 345',
      accountName: 'NGUYEN VAN A',
      amount: 15000.4,
      addInfo: '3SU thu no',
    })
    expect(url).toBe(
      'https://img.vietqr.io/image/VCB-012345-compact2.png?amount=15000&addInfo=3SU%20thu%20no&accountName=NGUYEN%20VAN%20A',
    )
  })

  it('payQrSrc ưu tiên VietQR động, không thì ảnh tĩnh', () => {
    expect(payQrSrc(DEFAULT_SETTINGS, 1000)).toBeNull()
    expect(payQrSrc({ ...DEFAULT_SETTINGS, transferQr: 'data:image/png;base64,xx' }, 1000)).toBe('data:image/png;base64,xx')
    const dyn = vietQrFromSettings({ ...DEFAULT_SETTINGS, bankBin: '970436', bankAccount: '1' }, 2000, 'x')
    expect(dyn).toContain('970436-1-compact2.png')
    expect(dyn).toContain('amount=2000')
  })
})
