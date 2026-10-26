import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(root, '..')
const output = resolve(root, 'assets/screenshots')
const explicitBase = process.env.HYS_VIDEO_BASE_URL
let base = explicitBase || 'http://127.0.0.1:5180'
let server
let browser

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

async function ensureServer() {
  if (await reachable(base)) return
  if (explicitBase) throw new Error(`无法访问 ${explicitBase}`)
  base = 'http://localhost:5174'
  if (await reachable(base)) return
  server = spawn('pnpm', ['exec', 'vite', '--host', 'localhost', '--port', '5174', '--strictPort'], {
    cwd: appRoot,
    detached: true,
    stdio: 'ignore',
  })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await reachable(base)) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000))
  }
  throw new Error('本地开发服务启动超时')
}

async function capture() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  const files = []

  async function open(path) {
    await page.goto(base + path, { waitUntil: 'networkidle' })
    await page.addStyleTag({
      content: '.app-user,.app-quota,a[href="/admin"],button[title="退出登录"]{display:none!important}*{scroll-behavior:auto!important}',
    })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(1200)
  }

  async function shot(name, fullPage = false) {
    const path = resolve(output, `${name}.png`)
    await page.screenshot({ path, fullPage, animations: 'disabled' })
    files.push(`${name}.png`)
    console.log(`captured ${name}`)
  }

  await open('/')
  await shot('home')
  const topicInput = page.locator('input[placeholder*="想学什么"]').first()
  await topicInput.fill('价值投资：从 ROE 到盈利质量')
  await shot('home-typed')

  await open('/topic/t_8eda2de5')
  await page.locator('.vue-flow__controls-fitview').click().catch(() => {})
  await page.waitForTimeout(700)
  await shot('graph')
  const roeNode = page.locator('.vue-flow__node').filter({ hasText: 'ROE 是什么' }).first()
  if (await roeNode.count()) await roeNode.click()
  else await page.locator('.vue-flow__node').first().click()
  await page.waitForTimeout(500)
  await shot('graph-panel')

  await open('/lesson/l_oiwo36tc')
  await page.locator('.lesson__header').waitFor()
  await shot('lesson-top')
  const formulaHeading = page.getByText('二、拆开公式', { exact: false }).first()
  await formulaHeading.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, -130))
  await page.waitForTimeout(600)
  await shot('lesson-formula')
  const sources = page.locator('.lesson__sources').last()
  await sources.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, -100))
  await page.waitForTimeout(400)
  await shot('lesson-sources')

  await open('/lesson/l_oiwo36tc/exercise')
  await page.locator('.mastery').waitFor()
  await shot('practice')
  await page.locator('.mastery').scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, -130))
  await page.waitForTimeout(400)
  await shot('mastery')

  await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ base, files }, null, 2))
  await context.close()
}

try {
  await mkdir(output, { recursive: true })
  await ensureServer()
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  await capture()
} finally {
  if (browser) await browser.close()
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch {}
  }
}
