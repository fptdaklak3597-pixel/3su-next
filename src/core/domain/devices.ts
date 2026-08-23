/**
 * 3SU Next — Ghép đôi thiết bị (Device pairing)
 * Port từ 60-device-pairing.js.
 * Mỗi thiết bị có ID ổn định; danh sách thiết bị đã ghép lưu local,
 * đồng bộ qua cloud (f14) để nhiều máy dùng chung một cửa hàng.
 */
import { dbx, getMeta, setMeta } from '../db'
import { uid } from '../format'
import type { PairedDevice } from '../types'
import { makeOp, persistOp, requestFlush } from '../sync/engine'
import { requireOwnerAdmin } from './auth'

/** ID ổn định của thiết bị này (sinh một lần, lưu meta). */
export async function getThisDeviceId(): Promise<string> {
  let id = await getMeta<string>('deviceId', '')
  if (!id) {
    id = uid('dev')
    await setMeta('deviceId', id)
  }
  return id
}

export function devicePlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  if (/iP(hone|ad|od)/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac/.test(ua)) return 'macOS'
  if (/Linux/.test(ua)) return 'Linux'
  return 'unknown'
}

/** Đăng ký / cập nhật thiết bị hiện tại vào danh sách ghép đôi. */
export async function registerThisDevice(name?: string): Promise<PairedDevice> {
  const deviceId = await getThisDeviceId()
  const existing = await dbx.devices.where('deviceId').equals(deviceId).first()
  const now = Date.now()
  const dev: PairedDevice = {
    id: existing?.id ?? uid('pd'),
    deviceId,
    name: name?.trim() || existing?.name || devicePlatform(),
    platform: devicePlatform(),
    pairedAt: existing?.pairedAt ?? now,
    lastSeen: now,
    isThis: true,
  }
  const { isThis: _isThis, ...syncDev } = dev
  const same = !!existing
    && existing.name === dev.name
    && existing.platform === dev.platform
    && existing.role === dev.role
  const neverPushed = !(await getMeta<number>('device:cloudAt', 0))
  const push = !same || neverPushed
  await dbx.transaction('rw', [dbx.devices, dbx.syncQueue, dbx.appliedOps, dbx.meta], async () => {
    await dbx.devices.put(dev)
    if (push) {
      await persistOp(makeOp('device.upsert', { device: syncDev }))
      await setMeta('device:cloudAt', now)
    }
  })
  if (push) requestFlush()
  return dev
}

/** Cập nhật thời điểm hoạt động gần nhất của thiết bị này. */
export async function touchThisDevice(): Promise<void> {
  const deviceId = await getThisDeviceId()
  const existing = await dbx.devices.where('deviceId').equals(deviceId).first()
  if (existing) {
    existing.lastSeen = Date.now()
    await dbx.devices.put(existing)
  }
}

export async function setDeviceRole(id: string, role: 'print-agent' | ''): Promise<void> {
  const d = await dbx.devices.get(id)
  if (!d) return
  d.role = role || undefined
  await dbx.devices.put(d)
}

export async function removeDevice(id: string): Promise<void> {
  await requireOwnerAdmin()
  const dev = await dbx.devices.get(id)
  if (dev?.isThis) throw new Error('Không thể gỡ thiết bị đang dùng')
  if (!dev) return
  await dbx.transaction('rw', [dbx.devices, dbx.syncQueue, dbx.appliedOps], async () => {
    await persistOp(makeOp('device.remove', { deviceId: dev.deviceId }))
    await dbx.devices.delete(id)
  })
  requestFlush()
}

/** Mã ghép đôi ngắn (6 ký tự) để nhập trên thiết bị khác. */
export function generatePairCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}
