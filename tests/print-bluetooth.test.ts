import { describe, expect, it } from 'vitest'
import { canUseBluetoothPrint } from '@/core/browser/printBluetooth'
import { ticketToEscPos, testTicket } from '@/core/browser/printTicket'

describe('Web Bluetooth ESC/POS', () => {
  it('Node / jsdom không có Web Bluetooth', () => {
    expect(canUseBluetoothPrint()).toBe(false)
  })

  it('ticketToEscPos dựng được byte in nhiệt', () => {
    const bytes = ticketToEscPos(testTicket('Tạp hóa An', 80))
    expect(bytes.byteLength).toBeGreaterThan(16)
    expect(bytes[0]).toBe(0x1b)
    expect(bytes[1]).toBe(0x40)
  })
})
