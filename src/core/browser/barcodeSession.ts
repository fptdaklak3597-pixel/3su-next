export type ScanSession = {
  cancelled: boolean
  cancel: () => void
  adopt: (handle: { cancel: () => void }) => void
}

export function createScanSession(): ScanSession {
  let handle: { cancel: () => void } | null = null
  const session: ScanSession = {
    cancelled: false,
    cancel() {
      session.cancelled = true
      handle?.cancel()
    },
    adopt(next) {
      handle = next
      if (session.cancelled) next.cancel()
    },
  }
  return session
}
