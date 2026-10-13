import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendJson } from '../index'
import { addHighlight, listHighlights, removeHighlight } from '../services/highlight-service'
import { findLesson } from '../services/lesson-service'
import { highlightInputSchema } from '../../shared/types'
import { readBody } from './topics'

// GET /api/lessons/:lid/highlights — 该课全部划线
export async function handleListHighlights(
  _req: IncomingMessage,
  res: ServerResponse,
  lessonId: string,
): Promise<void> {
  const detail = await findLesson(lessonId)
  if (!detail) {
    sendJson(res, 404, { error: '课程不存在' })
    return
  }
  sendJson(res, 200, { highlights: await listHighlights(detail.topic.id, lessonId) })
}

// POST /api/lessons/:lid/highlights — 新增一条划线
export async function handleCreateHighlight(
  req: IncomingMessage,
  res: ServerResponse,
  lessonId: string,
): Promise<void> {
  const body = highlightInputSchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: body.error.issues.map((i) => i.message).join('；') })
    return
  }
  const detail = await findLesson(lessonId)
  if (!detail) {
    sendJson(res, 404, { error: '课程不存在' })
    return
  }
  const highlight = await addHighlight(
    detail.topic.id,
    lessonId,
    body.data,
    detail.lesson.nodeIds[0],
  )
  sendJson(res, 200, { highlight })
}

// DELETE /api/lessons/:lid/highlights/:hid — 删除一条划线
export async function handleDeleteHighlight(
  _req: IncomingMessage,
  res: ServerResponse,
  lessonId: string,
  highlightId: string,
): Promise<void> {
  const detail = await findLesson(lessonId)
  if (!detail) {
    sendJson(res, 404, { error: '课程不存在' })
    return
  }
  const ok = await removeHighlight(detail.topic.id, lessonId, highlightId)
  sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '划线不存在' })
}