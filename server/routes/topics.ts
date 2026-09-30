import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { sendJson } from '../index'
import { startSse } from '../sse'
import { createTopic, getGraph, getTopic, listTopics, saveGraph } from '../services/graph-service'
import { chatGraphEdit } from '../services/graph-chat-service'
import { knowledgeNodeSchema } from '../../shared/types'

export async function readBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') as T
}

const saveGraphBodySchema = z.object({
  nodes: z.array(knowledgeNodeSchema),
})

export async function handleTopics(
  req: IncomingMessage,
  res: ServerResponse,
  topicId: string | undefined,
  sub: string | undefined,
): Promise<void> {
  // GET /api/topics — 课题列表
  if (!topicId && req.method === 'GET') {
    sendJson(res, 200, { topics: await listTopics() })
    return
  }

  // POST /api/topics — 创建课题并生成图谱（SSE 推进度）
  if (!topicId && req.method === 'POST') {
    const body = await readBody<{ name?: string }>(req)
    const name = (body.name ?? '').trim()
    if (!name) {
      sendJson(res, 400, { error: '课题名不能为空' })
      return
    }
    const send = startSse(res)
    try {
      const result = await createTopic(name, (stage, detail) => send('stage', { stage, detail }))
      send('result', result)
    } catch (err) {
      send('error', { message: err instanceof Error ? err.message : String(err) })
    } finally {
      res.end()
    }
    return
  }

  if (!topicId) {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  // GET /api/topics/:id/graph — 课题 + 图谱
  if (sub === 'graph' && req.method === 'GET') {
    const topic = await getTopic(topicId)
    if (!topic) {
      sendJson(res, 404, { error: '课题不存在' })
      return
    }
    sendJson(res, 200, { topic, graph: await getGraph(topicId) })
    return
  }

  // PATCH /api/topics/:id/graph — 手动编辑保存（全量替换节点）
  if (sub === 'graph' && req.method === 'PATCH') {
    const body = saveGraphBodySchema.safeParse(await readBody(req))
    if (!body.success) {
      sendJson(res, 400, { error: body.error.issues.map((i) => i.message).join('；') })
      return
    }
    try {
      const graph = await saveGraph(topicId, body.data.nodes)
      sendJson(res, 200, { graph })
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500
      sendJson(res, status, { error: err instanceof Error ? err.message : String(err) })
    }
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

const graphChatBodySchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(20)
    .default([]),
})

// POST /api/topics/:id/graph/chat — 图谱 AI 对话式调整（返回修改建议，前端确认后应用）
export async function handleGraphChat(
  req: IncomingMessage,
  res: ServerResponse,
  topicId: string,
): Promise<void> {
  const body = graphChatBodySchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: body.error.issues.map((i) => i.message).join('；') })
    return
  }
  try {
    const result = await chatGraphEdit(topicId, body.data.message, body.data.history)
    sendJson(res, 200, result)
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500
    sendJson(res, status, { error: err instanceof Error ? err.message : String(err) })
  }
}
