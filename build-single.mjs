// Combines index.html + p2p-bundle.js into a single standalone HTML file
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

const html = readFileSync('web-chat/index.html', 'utf-8')
const bundle = readFileSync('web-chat/p2p-bundle.js', 'utf-8')

// Replace module import with inlined script
const singleFile = html
  .replace(
    `<script type="module">\n    import './p2p-bundle.js'`,
    `<script>\n    // === INLINED libp2p bundle (${Math.round(bundle.length/1024)}KB) ===\n` + bundle + `\n    // === END INLINED ===`
  )

if (!existsSync('docs')) mkdirSync('docs')
writeFileSync('docs/index.html', singleFile)
console.log(`✅ Created docs/index.html (${Math.round(singleFile.length/1024)}KB)`)

// Also create standalone file at root for easy access
writeFileSync('eatpan-chat.html', singleFile)
console.log(`✅ Created eatpan-chat.html (portable single file)`)
