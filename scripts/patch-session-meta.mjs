import fs from 'node:fs'

const file = 'src/core/domain/auth.ts'
let text = fs.readFileSync(file, 'utf8')
const source = "await dbx.meta.put({ key: 'currentUser', value: next })"
const target = "await dbx.meta.put({ key: 'currentUser', value: next.id })"
const matches = text.split(source).length - 1
if (matches !== 2) throw new Error(`Expected 2 currentUser object writes, found ${matches}`)
text = text.split(source).join(target)
fs.writeFileSync(file, text)
