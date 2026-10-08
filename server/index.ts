import type { IncomingMessage, ServerResponse } from 'node:http'
import { healthRoute } from './routes/health'
import { handleGraphChat, handleTopics } from './routes/topics'
import {
  handleApplyLessonChat,
  handleCreateLesson,
  handleDeleteLesson,
  handleFindLesson,
  handleGetLesson,
  handleGetLessonChat,
  handleLessonProgress,
  handleListAttempts,
  handleListLessons,
  handlePostLessonChat,
  handleRegenerateQuestions,
  handleReviseLesson,
  handleSubmitLesson,
  handleUndoLessonChat,
} from './routes/lessons'
import { handleCreateReport, handleListReports } from './routes/reports'
import { handleGetAsset, handleUploadAsset } from './routes/assets'
import {
  handleGetSettings,
  handleImportCandidate,
  handleListImportCandidates,
  handleUpdateSettings,
} from './routes/settings'

type Next = (err?: unknown) => void

// 极简路由分发：url 已被 vite middleware 剥掉 /api 前缀
export async function handleApi(req: IncomingMessage, res: ServerResponse, next: Next) {
  const url = (req.url ?? '/').split('?')[0]

  try {
    if (req.method === 'GET' && url === '/health') {
      healthRoute(req, res)
      return
    }

    // POST /api/topics/:id/lessons — 备课（SSE）；GET — 课程列表
    const createLessonMatch = url.match(/^\/topics\/([^/]+)\/lessons$/)
    if (createLessonMatch && req.method === 'POST') {
      await handleCreateLesson(req, res, createLessonMatch[1])
      return
    }
    if (createLessonMatch && req.method === 'GET') {
      await handleListLessons(req, res, createLessonMatch[1])
      return
    }

    // GET /api/topics/:tid/lessons/:lid — 读取课程
    const getLessonMatch = url.match(/^\/topics\/([^/]+)\/lessons\/([^/]+)$/)
    if (getLessonMatch && req.method === 'GET') {
      await handleGetLesson(req, res, getLessonMatch[1], getLessonMatch[2])
      return
    }

    // POST /api/lessons/:lid/revise — 课件 AI 优化；DELETE — 删除课件
    const reviseMatch = url.match(/^\/lessons\/([^/]+)\/revise$/)
    if (reviseMatch && req.method === 'POST') {
      await handleReviseLesson(req, res, reviseMatch[1])
      return
    }

    // 课件 AI 对话式优化：GET 历史 / POST 对话 / POST apply / POST undo
    const chatApplyMatch = url.match(/^\/lessons\/([^/]+)\/chat\/apply$/)
    if (chatApplyMatch && req.method === 'POST') {
      await handleApplyLessonChat(req, res, chatApplyMatch[1])
      return
    }
    const chatUndoMatch = url.match(/^\/lessons\/([^/]+)\/chat\/undo$/)
    if (chatUndoMatch && req.method === 'POST') {
      await handleUndoLessonChat(req, res, chatUndoMatch[1])
      return
    }
    const chatMatch = url.match(/^\/lessons\/([^/]+)\/chat$/)
    if (chatMatch && req.method === 'GET') {
      await handleGetLessonChat(req, res, chatMatch[1])
      return
    }
    if (chatMatch && req.method === 'POST') {
      await handlePostLessonChat(req, res, chatMatch[1])
      return
    }
    const deleteMatch = url.match(/^\/lessons\/([^/]+)$/)
    if (deleteMatch && req.method === 'DELETE') {
      await handleDeleteLesson(req, res, deleteMatch[1])
      return
    }

    // GET /api/lessons/:lid/progress — SSE 挂接备课进度
    const progressMatch = url.match(/^\/lessons\/([^/]+)\/progress$/)
    if (progressMatch && req.method === 'GET') {
      await handleLessonProgress(req, res, progressMatch[1])
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

    // GET /api/lessons/:lid/attempts — 该课全部测验记录
    const attemptsMatch = url.match(/^\/lessons\/([^/]+)\/attempts$/)
    if (attemptsMatch && req.method === 'GET') {
      await handleListAttempts(req, res, attemptsMatch[1])
      return
    }

    // POST /api/lessons/:lid/questions/regenerate — 再次测验，重新出题
    const regenMatch = url.match(/^\/lessons\/([^/]+)\/questions\/regenerate$/)
    if (regenMatch && req.method === 'POST') {
      await handleRegenerateQuestions(req, res, regenMatch[1])
      return
    }

    // POST /api/topics/:id/graph/chat — 图谱 AI 对话式调整
    const graphChatMatch = url.match(/^\/topics\/([^/]+)\/graph\/chat$/)
    if (graphChatMatch && req.method === 'POST') {
      await handleGraphChat(req, res, graphChatMatch[1])
      return
    }

    // GET/PATCH /api/settings — LLM 配置
    if (url === '/settings' && (req.method === 'GET' || req.method === 'PATCH')) {
      if (req.method === 'GET') await handleGetSettings(req, res)
      else await handleUpdateSettings(req, res)
      return
    }

    // GET /api/settings/import-candidates — 扫描本机 AI 工具配置；POST /api/settings/import — 确认导入
    if (url === '/settings/import-candidates' && req.method === 'GET') {
      await handleListImportCandidates(req, res)
      return
    }
    if (url === '/settings/import' && req.method === 'POST') {
      await handleImportCandidate(req, res)
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

    // GET /api/topics/:tid/assets/:file — 课件配图；POST /api/topics/:tid/assets — 上传图片
    const assetFileMatch = url.match(/^\/topics\/([^/]+)\/assets\/([^/]+)$/)
    if (assetFileMatch && req.method === 'GET') {
      await handleGetAsset(req, res, assetFileMatch[1], assetFileMatch[2])
      return
    }
    const assetUploadMatch = url.match(/^\/topics\/([^/]+)\/assets$/)
    if (assetUploadMatch && req.method === 'POST') {
      await handleUploadAsset(req, res, assetUploadMatch[1])
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
