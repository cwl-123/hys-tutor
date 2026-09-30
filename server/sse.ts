import type { ServerResponse } from 'node:http'

export type SseSend = (event: string, data: unknown) => void

export function startSse(res: ServerResponse): SseSend {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write(':connected\n\n')
  return (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
}
