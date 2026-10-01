// 生产服务器：静态托管 dist/ + 同进程承载 /api（launchd 常驻）
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { handleApi } from './index'

const DIST = path.resolve(process.cwd(), 'dist')
const PORT = Number(process.env.PORT || 5180)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

async function sendFile(res: ServerResponse, file: string, status = 200): Promise<void> {
  const body = await readFile(file)
  const ext = path.extname(file)
  res.statusCode = status
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=86400')
  res.end(body)
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = path.normalize(path.join(DIST, relative))
  if (!file.startsWith(DIST)) {
    res.statusCode = 403
    res.end('forbidden')
    return
  }
  try {
    await sendFile(res, file)
  } catch {
    // SPA fallback：非资源路径回落到 index.html
    if (!path.extname(relative)) {
      await sendFile(res, path.join(DIST, 'index.html'))
    } else {
      res.statusCode = 404
      res.end('not found')
    }
  }
}

// 常驻服务兜底：任何漏网异常只记日志，不让进程退出（launchd 重启会中断在途备课）
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err)
})

const server = createServer((req, res) => {
  const url = req.url ?? '/'
  if (url === '/api' || url.startsWith('/api/')) {
    req.url = url.slice(4) || '/'
    handleApi(req, res, () => {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Not found' }))
    }).catch((err) => {
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      } else {
        res.end()
      }
    })
    return
  }
  serveStatic(req, res).catch(() => {
    res.statusCode = 500
    res.end('internal error')
  })
})

// 仅监听本机回环：/api/settings 会返回真实 API key，严禁暴露到局域网
server.listen(PORT, '127.0.0.1', () => {
  console.log(`hys-tutor serving on http://127.0.0.1:${PORT}`)
})
