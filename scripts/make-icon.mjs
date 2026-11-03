// Renders build/icon.svg to build/icon.png (1024 px), build/icon.ico and docs/assets/logo-{512,256}.png under Electron: `npm run icon` (= electron scripts/make-icon.mjs).
// No image dependency needed.
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const { app, BrowserWindow } = createRequire(import.meta.url)('electron')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'build', 'icon.png')
const SIZE = 1024

const svg = readFileSync(resolve(root, 'build', 'icon.svg'), 'utf8').replace('<svg ', '<svg style="display:block" ')

// Hard stop so a stuck capture can never leave an Electron process behind.
setTimeout(() => {
  console.error('make-icon timed out')
  app.exit(1)
}, 30_000).unref()

// No top-level await on app.whenReady(): Electron waits for the entry module to finish before 'ready'.
async function main() {
  await app.whenReady()
  const win = new BrowserWindow({
    show: false,
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true }
  })
  const html = `<!doctype html><html><body style="margin:0;overflow:hidden;background:transparent">${svg}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 800))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, img.toPNG())
  const assets = resolve(root, 'docs', 'assets')
  mkdirSync(assets, { recursive: true })
  for (const n of [512, 256]) writeFileSync(resolve(assets, 'logo-' + n + '.png'), img.resize({ width: n, height: n, quality: 'best' }).toPNG())
  // ICO with embedded PNG frames (Vista+).
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const frames = sizes.map((n) => img.resize({ width: n, height: n, quality: 'best' }).toPNG())
  const head = Buffer.alloc(6 + 16 * sizes.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(sizes.length, 4)
  let off = head.length
  sizes.forEach((n, i) => {
    const e = 6 + 16 * i
    head[e] = n === 256 ? 0 : n
    head[e + 1] = n === 256 ? 0 : n
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(frames[i].length, e + 8)
    head.writeUInt32LE(off, e + 12)
    off += frames[i].length
  })
  writeFileSync(resolve(root, 'build', 'icon.ico'), Buffer.concat([head, ...frames]))
  console.error('wrote', out, JSON.stringify(img.getSize()))
  app.exit(0)
}

main().catch((e) => {
  console.error(e)
  app.exit(1)
})
