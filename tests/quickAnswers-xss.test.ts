import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import { answerQuestion, createQuickAnswer } from '@/core/browser/quickAnswers'

beforeEach(async () => {
  await dbx.quickAnswers.clear()
  await initSyncEngine()
})

describe('answerQuestion XSS', () => {
  it('escape HTML trong câu trả lời tùy chỉnh', async () => {
    await createQuickAnswer('doanh thu', '<img src=x onerror=alert(1)>hack')
    const html = await answerQuestion('doanh thu hôm nay?', [], [], [], 5)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    expect(html).toContain('onerror')
  })
})
