/** Chặn double-submit: state React cập nhật muộn một render. */
export function createConfirmGate() {
  let busy = false
  return {
    tryEnter(): boolean {
      if (busy) return false
      busy = true
      return true
    },
    leave(): void {
      busy = false
    },
  }
}
