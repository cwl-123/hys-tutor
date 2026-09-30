import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendJson } from '../index'
import { addReport, listReports } from '../services/report-service'
import { findLesson } from '../services/lesson-service'
import { reportInputSchema } from '../../shared/types'
import { readBody } from './topics'

// POST /api/reports — "这里有错"标记（通过 lessonId 反查课题落盘）
export async function handleCreateReport(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = reportInputSchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: body.error.issues.map((i) => i.message).join('；') })
    return
  }
  const detail = await findLesson(body.data.lessonId)
  if (!detail) {
    sendJson(res, 404, { error: '课程不存在' })
    return
  }
  const report = await addReport(detail.topic.id, body.data)
  sendJson(res, 200, { report })
}

// GET /api/topics/:id/reports — 报错记录列表（页面展示用）
export async function handleListReports(
  _req: IncomingMessage,
  res: ServerResponse,
  topicId: string,
): Promise<void> {
  sendJson(res, 200, { reports: await listReports(topicId) })
}
