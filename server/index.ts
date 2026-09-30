import type { IncomingMessage, ServerResponse } from 'node:http'
import { healthRoute } from './routes/health'
import { handleTopics } from './routes/topics'
import { handleCreateLesson, handleFindLesson, handleGetLesson, handleSubmitLesson } from './routes/lessons'
import { handleCreateReport, handleListReports } from './routes/reports'

type Next = (err?: unknown) => void

// 极简路由分发：url 已被 vite middleware 剥掉 /api 前缀
export async function handleApi(req: IncomingMessage, res: ServerResponse, next: Next) {
  const url = (req.url ?? '/').split('?')[0]

  try {
    if (req.method === 'GET' && url === '/health') {
      healthRoute(req, res)
      return
    }

    // POST /api/topics/:id/lessons — 备课（SSE）
    const createLessonMatch = url.match(/^\/topics\/([^/]+)\/lessons$/)
    if (createLessonMatch && req.method === 'POST') {
      await handleCreateLesson(req, res, createLessonMatch[1])
      return
    }

    // GET /api/topics/:tid/lessons/:lid — 读取课程
    const getLessonMatch = url.match(/^\/topics\/([^/]+)\/lessons\/([^/]+)$/)
    if (getLessonMatch && req.method === 'GET') {
      await handleGetLesson(req, res, getLessonMatch[1], getLessonMatch[2])
      return
    }

    // GET /api/lessons/:lid — 按 lessonId 反查
    const findLessonMatch = url.match(/^\/lessons\/([^/]+)$/)
    if (findLessonMatch && req.method === 'GET') {
      await handleFindLesson(req, res, findLessonMatch[1])
      return
    }

    // POST /api/lessons/:lid/submit — 交卷批改
    const submitMatch = url.match(/^\/lessons\/([^/]+)\/submit$/)
    if (submitMatch && req.method === 'POST') {
      await handleSubmitLesson(req, res, submitMatch[1])
      return
    }

    // POST /api/reports — "这里有错"标记
    if (url === '/reports' && req.method === 'POST') {
      await handleCreateReport(req, res)
      return
    }

    // GET /api/topics/:id/reports — 报错记录
    const reportsMatch = url.match(/^\/topics\/([^/]+)\/reports$/)
    if (reportsMatch && req.method === 'GET') {
      await handleListReports(req, res, reportsMatch[1])
      return
    }

    const topicsMatch = url.match(/^\/topics(?:\/([^/]+)(?:\/([^/]+))?)?$/)
    if (topicsMatch) {
      await handleTopics(req, res, topicsMatch[1], topicsMatch[2])
      return
    }

    next()
  } catch (err) {
    if (res.headersSent) {
      res.end()
      return
    }
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
