import { afterEach, describe, expect, it } from 'vitest'
import { isDevUiPreview } from '@/core/devPreview'

describe('isDevUiPreview', () => {
  afterEach(() => {
    sessionStorage.removeItem('3su_dev_ui_preview')
    window.history.pushState({}, '', '/')
  })

  it('giữ preview khi chuyển trang mất query', () => {
    window.history.pushState({}, '', '/?preview=1')
    expect(isDevUiPreview()).toBe(true)
    window.history.pushState({}, '', '/kho')
    expect(isDevUiPreview()).toBe(true)
  })

  it('tắt khi preview=0', () => {
    window.history.pushState({}, '', '/?preview=1')
    expect(isDevUiPreview()).toBe(true)
    window.history.pushState({}, '', '/?preview=0')
    expect(isDevUiPreview()).toBe(false)
  })
})
