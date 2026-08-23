/**
 * In ESC/POS qua Web Bluetooth (máy nhiệt K80/K58 trên điện thoại).
 * Nhiều máy Trung Quốc dùng Nordic UART 0x18f0 hoặc service FEIE.
 */
import { ticketToEscPos, type PrintTicket } from './printTicket'

const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
] as const

const WRITE_CHARS = [
  '00002af1-0000-1000-8000-00805f9b34fb',
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
] as const

const CHUNK = 512

interface BleChar {
  properties: { write?: boolean; writeWithoutResponse?: boolean }
  writeValueWithoutResponse?(data: BufferSource): Promise<void>
  writeValue(data: BufferSource): Promise<void>
}

interface BleService {
  uuid: string
  getCharacteristic(uuid: string): Promise<BleChar>
  getCharacteristics(): Promise<BleChar[]>
}

interface BleServer {
  getPrimaryService(uuid: string): Promise<BleService>
}

interface BleDevice {
  gatt?: {
    connected: boolean
    connect(): Promise<BleServer>
  }
}

interface BluetoothNavigator {
  requestDevice(opts: {
    filters?: Array<{ services: string[] }>
    optionalServices?: string[]
    acceptAllDevices?: boolean
  }): Promise<BleDevice>
  getDevices?(): Promise<BleDevice[]>
}

function bluetoothApi(): BluetoothNavigator | null {
  if (typeof navigator === 'undefined') return null
  const bt = (navigator as unknown as { bluetooth?: BluetoothNavigator }).bluetooth
  return bt ?? null
}

export function canUseBluetoothPrint(): boolean {
  return bluetoothApi() !== null
}

async function pickDevice(requestIfNeeded: boolean): Promise<BleDevice> {
  const bt = bluetoothApi()
  if (!bt) throw new Error('Trình duyệt không hỗ trợ Bluetooth')
  const known = typeof bt.getDevices === 'function' ? await bt.getDevices() : []
  if (known[0]) return known[0]
  if (!requestIfNeeded) throw new Error('Chưa chọn máy in Bluetooth')
  try {
    return await bt.requestDevice({
      acceptAllDevices: true,
      optionalServices: [...PRINTER_SERVICES],
    })
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    if (name === 'NotFoundError' || name === 'NotAllowedError') {
      throw new Error('Đã hủy chọn máy in')
    }
    throw e instanceof Error ? e : new Error('Không kết nối được máy in')
  }
}

async function findWriteChar(server: BleServer): Promise<BleChar> {
  for (const serviceId of PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(serviceId)
      for (const charId of WRITE_CHARS) {
        try {
          return await service.getCharacteristic(charId)
        } catch { /* thử char khác */ }
      }
      const chars = await service.getCharacteristics()
      const writable = chars.find((c) => c.properties.writeWithoutResponse || c.properties.write)
      if (writable) return writable
    } catch { /* thử service khác */ }
  }
  throw new Error('Máy Bluetooth không nhận lệnh in ESC/POS')
}

async function writeChunks(char: BleChar, bytes: Uint8Array): Promise<void> {
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.slice(i, i + CHUNK)
    if (char.properties.writeWithoutResponse && char.writeValueWithoutResponse) {
      await char.writeValueWithoutResponse(slice)
    } else {
      await char.writeValue(slice)
    }
  }
}

export async function printEscPosBluetooth(
  bytes: Uint8Array,
  opts: { requestIfNeeded?: boolean } = {},
): Promise<void> {
  const device = await pickDevice(opts.requestIfNeeded !== false)
  const gatt = device.gatt
  if (!gatt) throw new Error('Máy in không có GATT')
  const server = gatt.connected ? await gatt.connect() : await gatt.connect()
  const char = await findWriteChar(server)
  await writeChunks(char, bytes)
}

export async function printTicketBluetooth(
  ticket: PrintTicket,
  opts: { requestIfNeeded?: boolean } = {},
): Promise<void> {
  await printEscPosBluetooth(ticketToEscPos(ticket), opts)
}
