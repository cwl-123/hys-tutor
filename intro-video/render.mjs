import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

const root = dirname(fileURLToPath(import.meta.url))
const output = resolve(root, 'output')
const preview = process.argv.includes('--preview')
const stills = process.argv.includes('--stills')
const fps = preview ? 15 : 30
const width = preview ? 960 : 1920
const height = preview ? 540 : 1080
let browser
let httpServer
let encoder

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav',
}

async function startServer() {
  httpServer = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      const relative = pathname === '/' ? 'src/index.html' : pathname.replace(/^\/+/, '')
      const path = resolve(root, relative)
      if (!path.startsWith(root + sep)) {
        response.writeHead(403).end()
        return
      }
      const body = await readFile(path)
      response.writeHead(200, {
        'Content-Type': mimeTypes[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  httpServer.listen(0, '127.0.0.1')
  await once(httpServer, 'listening')
  return `http://127.0.0.1:${httpServer.address().port}`
}

async function inspectLayout(page, timeline) {
  const reports = []
  for (const scene of timeline.scenes) {
    const time = scene.start + (scene.end - scene.start) * 0.58
    const report = await page.evaluate((frameTime) => {
      const state = window.renderAt(frameTime)
      const active = document.querySelector(`[data-scene="${state.scene}"]`)
      const selector = 'h1,h2,.browser,.floating-chip,.graph__badge,.preference-pill,.lesson__tools,.score-pop,.loop-node,.subtitle'
      const overflowing = Array.from(active.querySelectorAll(selector))
        .filter((element) => getComputedStyle(element).display !== 'none')
        .map((element) => {
          const rect = element.getBoundingClientRect()
          return { name: element.className || element.tagName, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }
        })
        .filter((rect) => rect.x < -2 || rect.y < -2 || rect.right > 1922 || rect.bottom > 1082)
      const subtitleRect = document.querySelector('#subtitle').getBoundingClientRect()
      if (subtitleRect.left < -2 || subtitleRect.right > 1922) overflowing.push({ name: 'active-subtitle', right: subtitleRect.right, x: subtitleRect.x })
      return { scene: state.scene, overflowing }
    }, time)
    reports.push(report)
  }
  await writeFile(resolve(output, 'layout-report.json'), JSON.stringify(reports, null, 2))
  const failures = reports.filter((report) => report.overflowing.length > 0)
  if (failures.length) throw new Error(`画面越界：${JSON.stringify(failures)}`)
  console.log('layout checks passed')
}

async function renderKeyframes(page, timeline) {
  const directory = resolve(output, 'keyframes')
  await mkdir(directory, { recursive: true })
  for (const scene of timeline.scenes) {
    const ratios = scene.id === 'lesson' ? [0.25, 0.52, 0.82] : scene.id === 'practice' ? [0.28, 0.72] : [0.58]
    for (const ratio of ratios) {
      const time = scene.start + (scene.end - scene.start) * ratio
      await page.evaluate((frameTime) => window.renderAt(frameTime), time)
      const suffix = ratios.length > 1 ? `-${Math.round(ratio * 100)}` : ''
      await page.screenshot({ path: resolve(directory, `${scene.id}${suffix}.jpg`), type: 'jpeg', quality: 92 })
      console.log(`keyframe ${scene.id}${suffix}`)
    }
  }
}

async function renderVideo(page, timeline) {
  const filename = preview ? 'hys-tutor-intro-preview.mp4' : 'hys-tutor-intro-1080p.mp4'
  const destination = resolve(output, filename)
  const filters = preview ? 'scale=960:540:flags=lanczos,format=yuv420p' : 'format=yuv420p'
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'image2pipe',
    '-framerate',
    String(fps),
    '-vcodec',
    'mjpeg',
    '-i',
    'pipe:0',
    '-i',
    resolve(root, 'assets/audio/mix.wav'),
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-vf',
    filters,
    '-af',
    'loudnorm=I=-14:TP=-1.5:LRA=11',
    '-c:v',
    'libx264',
    '-preset',
    preview ? 'veryfast' : 'medium',
    '-crf',
    preview ? '22' : '18',
    '-r',
    String(fps),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-t',
    timeline.total.toFixed(3),
    '-movflags',
    '+faststart',
    destination,
  ]
  encoder = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] })
  let errors = ''
  encoder.stderr.on('data', (chunk) => {
    errors += chunk.toString()
  })
  const completed = new Promise((resolveDone, rejectDone) => {
    encoder.once('error', rejectDone)
    encoder.once('close', (code) => {
      if (code === 0) resolveDone()
      else rejectDone(new Error(`FFmpeg 退出码 ${code}: ${errors}`))
    })
  })
  const frameCount = Math.ceil(timeline.total * fps)
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = Math.min(frame / fps, timeline.total - 0.001)
    await page.evaluate((frameTime) => window.renderAt(frameTime), time)
    const image = await page.screenshot({ type: 'jpeg', quality: preview ? 88 : 94 })
    if (!encoder.stdin.write(image)) await once(encoder.stdin, 'drain')
    if (frame % (preview ? 150 : 300) === 0 || frame === frameCount - 1) {
      console.log(`rendered ${frame + 1}/${frameCount} frames`)
    }
  }
  encoder.stdin.end()
  await completed
  encoder = undefined
  console.log(`video ${destination}`)
  console.log(`format ${width}x${height} ${fps}fps ${timeline.total}s`)
}

try {
  await mkdir(output, { recursive: true })
  const base = await startServer()
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--force-color-profile=srgb', '--font-render-hinting=none'],
  })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  page.on('pageerror', (pageError) => console.error(pageError))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text())
  })
  await page.goto(`${base}/src/index.html`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.videoReady === true || Boolean(window.videoError), undefined, { timeout: 120000 })
  const error = await page.evaluate(() => window.videoError)
  if (error) throw new Error(error)
  const timeline = await page.evaluate(() => window.videoTimeline)
  const brokenImages = await page.evaluate(() => Array.from(document.images).filter((image) => !image.naturalWidth).map((image) => image.src))
  if (brokenImages.length) throw new Error(`图片加载失败：${brokenImages.join(', ')}`)
  await inspectLayout(page, timeline)
  if (stills) await renderKeyframes(page, timeline)
  else await renderVideo(page, timeline)
  await context.close()
} finally {
  if (encoder && encoder.exitCode === null) encoder.kill('SIGTERM')
  if (browser) await browser.close()
  if (httpServer) httpServer.close()
}
