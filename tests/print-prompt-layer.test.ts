import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

async function read(rel: string): Promise<string> {
  return readFile(resolve(ROOT, rel), 'utf8')
}

function zIndexAfter(css: string, selector: string): number {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
  const block = css.match(re)?.[1] ?? ''
  const z = block.match(/z-index:\s*(\d+)/)?.[1]
  expect(z, `missing z-index for ${selector}`).toBeTruthy()
  return Number(z)
}

describe('Tờ in sau chốt không bị “Hay lắm” che', () => {
  it('sheet in nằm trên celebration', async () => {
    const css = await read('src/index.css')
    expect(zIndexAfter(css, '.sheet-overlay--print')).toBeGreaterThan(zIndexAfter(css, '.celebration'))
  })

  it('mobile: nút In hóa đơn, gắn body, không đóng tờ khi chạm nền', async () => {
    const page = await read('src/mobile/pages/CheckoutPage.tsx')
    expect(page).toContain('sheet-overlay--print')
    expect(page).toContain('createPortal')
    expect(page).toMatch(/In hóa đơn/)
    const open = page.match(/doneSale && createPortal\([\s\S]*?<div className="sheet-overlay sheet-overlay--print">/)
    expect(open).toBeTruthy()
    expect(open?.[0] ?? '').not.toMatch(/onClick=\{\(\) => \{ setDoneSale\(null\); keepSearch/)
  })

  it('web: tờ in cùng lớp, không đóng khi chạm nền', async () => {
    const page = await read('src/web/pages/SalePage.tsx')
    expect(page).toContain('overlayClassName="sheet-overlay--print"')
    expect(page).toContain('closeOnOverlay={false}')
    expect(page).toContain('portal')
    expect(page).toMatch(/In hóa đơn/)
  })
})
