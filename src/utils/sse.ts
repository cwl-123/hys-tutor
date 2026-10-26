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
      const dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        // SSE 规范：多行 data: 以 \n 拼接
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length === 0) continue
      try {
        handlers.onEvent(event, JSON.parse(dataLines.join('\n')))
      } catch {
        // 一帧坏数据不应杀掉整条流，跳过即可
      }
    }
  }
}

// POST + SSE（发起任务等）
export async function postSse(url: string, body: unknown, handlers: SseHandlers): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
    throw new Error('登录已过期')
  }
  if (!res.ok) throw new Error(`SSE 请求失败：${res.status}`)
  await readSseStream(res, handlers)
}

// GET + SSE（挂接进度流）；signal 用于离开页面/重新挂接时中断旧连接
export async function getSse(url: string, handlers: SseHandlers, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal, credentials: 'same-origin' })
  if (res.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
    throw new Error('登录已过期')
  }
  if (!res.ok) throw new Error(`SSE 请求失败：${res.status}`)
  await readSseStream(res, handlers)
}
