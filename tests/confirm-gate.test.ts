import { describe, it, expect } from 'vitest'
import { createConfirmGate } from '@/core/confirmGate'

describe('createConfirmGate', () => {
  it('chặn lần bấm thứ hai khi lần một chưa leave', () => {
    const gate = createConfirmGate()
    expect(gate.tryEnter()).toBe(true)
    expect(gate.tryEnter()).toBe(false)
    gate.leave()
    expect(gate.tryEnter()).toBe(true)
  })
})
