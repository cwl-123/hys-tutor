export interface SseHandlers {
  onEvent: (event: string, data: unknown) => void
}

// 解析 SSE 帧（按 \n\n 分帧）
async function readSseStream(res: Response, handlers: SseHandlers): Promise<void> {
  if (!res.body) throw new Error('SSE 响应无 body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const frames = buf.split('\n\n')
    buf = frames.pop() ?? ''
    for (const frame of frames) {
      let event = 'message'
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (data) handlers.onEvent(event, JSON.parse(data))
    }
  }
}

// POST + SSE（发起任务等）
export async function postSse(url: string, body: unknown, handlers: SseHandlers): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`SSE 请求失败：${res.status}`)
  await readSseStream(res, handlers)
}

// GET + SSE（挂接进度流）
export async function getSse(url: string, handlers: SseHandlers): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`SSE 请求失败：${res.status}`)
  await readSseStream(res, handlers)
}
