/** Máy in PC có đang mở trang Máy in không (WS + GET). */

let online = false
const listeners = new Set<(v: boolean) => void>()

export function isPrintAgentOnline(): boolean {
  return online
}

export function setPrintAgentOnline(v: boolean): void {
  if (online === v) return
  online = v
  for (const fn of listeners) fn(v)
}

export function onPrintAgentOnline(fn: (v: boolean) => void): () => void {
  listeners.add(fn)
  fn(online)
  return () => { listeners.delete(fn) }
}
