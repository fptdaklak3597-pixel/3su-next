import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('PWA update policy', () => {
  it('pwa.ts không còn setTimeout(applyUpdate, idleMs) auto-apply', () => {
    const src = readFileSync(resolve('src/shared/pwa.ts'), 'utf8')
    expect(src).not.toMatch(/setTimeout\(\s*applyUpdate/)
    expect(src).not.toMatch(/idleMs\s*\?\?/)
  })
})
