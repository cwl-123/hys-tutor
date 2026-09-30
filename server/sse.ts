import type { ServerResponse } from 'node:http'

export type SseSend = (event: string, data: unknown) => void

// SSE 通道：写失败/客户端断开时静默降级（不抛异常炸进程），并定时心跳保活
export function startSse(res: ServerResponse): SseSend {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write(':connected\n\n')

  let closed = false
  res.on('close', () => {
    closed = true
  })
  res.on('error', () => {
    closed = true
  })

  const heartbeat = setInterval(() => {
    if (closed) return
    try {
      res.write(':hb\n\n')
    } catch {
      closed = true
    }
  }, 15_000)
  res.on('close', () => clearInterval(heartbeat))

  return (event, data) => {
    if (closed) return
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch {
      closed = true
    }
  }
}
