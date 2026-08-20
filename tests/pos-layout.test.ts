import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

async function read(rel: string): Promise<string> {
  return readFile(resolve(ROOT, rel), 'utf8')
}

describe('P2 bố cục POS', () => {
  it('catalog ô từ 1100px, list khi tìm', async () => {
    const theme = await read('src/web/theme.css')
    const sale = await read('src/web/pages/SalePage.tsx')

    expect(theme).toMatch(/@media\s*\(min-width:\s*1100px\)/)
    expect(theme).toContain('.web-plist.is-tiles')
    expect(theme).toMatch(/minmax\(\s*168px/)
    expect(theme).toMatch(/\.web-plist\.is-tiles\s+\.web-pc[\s\S]*min-height:\s*88px/)

    expect(sale).toContain('is-tiles')
    expect(sale).toContain('is-list')
    expect(sale).toMatch(/query\.trim\(\)/)
  })

  it('màn hẹp không cắt catalog bằng 46vh; giỏ sheet dưới 720px', async () => {
    const theme = await read('src/web/theme.css')
    const sale = await read('src/web/pages/SalePage.tsx')

    expect(theme).not.toContain('46vh')
    expect(theme).toMatch(/@media\s*\(max-width:\s*719px\)/)
    expect(theme).toContain('.web-cart-toggle')
    expect(theme).toContain('.web-pos-r.is-open')
    expect(sale).toContain('web-cart-toggle')
    expect(sale).toContain('is-open')
  })

  it('topbar 52px, in/cài đặt trong menu user, burger dưới 900px', async () => {
    const theme = await read('src/web/theme.css')
    const shell = await read('src/web/layout/WebShell.tsx')

    const topbar = theme.match(/\.web-topbar\s*\{([^}]*)\}/)
    expect(topbar?.[1]).toMatch(/height:\s*52px/)

    expect(theme).toContain('.web-user-menu')
    expect(theme).toContain('.web-burger')
    expect(theme).toContain('.web-nav-mid')

    expect(shell).toContain('web-user-menu')
    expect(shell).toContain('web-burger')
    expect(shell).toContain('web-nav-mid')

    const icoBlock = shell.match(/<div className="web-bar-r">([\s\S]*?)<\/div>\s*<\/nav>/)
    expect(icoBlock?.[1] ?? '').not.toMatch(/<Printer/)
    expect(icoBlock?.[1] ?? '').not.toMatch(/<Settings/)
  })
})
