/**
 * Khi đang mở tab Hóa đơn: kéo Cloud ngay và lặp lại, để HĐ máy vừa quét hiện ra.
 */
import { useEffect, useState } from 'react'
import type { SyncState } from '../types'
import { flushQueue, getSyncState, onSyncState } from './engine'

const PAGE_PULL_MS = 10_000

export function useInvoicePageSync(): SyncState {
  const [sync, setSync] = useState<SyncState>(getSyncState)
  useEffect(() => {
    const unsub = onSyncState(setSync)
    void flushQueue()
    const timer = setInterval(() => { void flushQueue() }, PAGE_PULL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void flushQueue()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      unsub()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  return sync
}

export function invoiceSyncCaption(sync: SyncState): string {
  if (sync.status === 'error') {
    return sync.error ? `Đồng bộ lỗi: ${sync.error}` : 'Đồng bộ hóa đơn bị lỗi'
  }
  if (sync.status === 'offline') return 'Mất mạng — chưa kéo được hóa đơn từ máy'
  if (sync.status === 'syncing') return 'Đang kéo hóa đơn từ máy…'
  if (sync.lastSyncAt) {
    return `Đã đồng bộ ${new Date(sync.lastSyncAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
  }
  return 'Chờ đồng bộ từ máy Invoice'
}
