import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { sendJson } from '../index'
import { startSse } from '../sse'
import { dataPath, nowIso, readJson, writeJson } from '../repo/json-store'
import { startLessonJob, attachLesson, subscribeJob, startReviseJob } from '../services/lesson-jobs'
import { deleteLesson, findLesson, getLessonDetail, listLessons, stripQuestions } from '../services/lesson-service'
import { gradeObjective, gradeShort } from '../services/grading-service'
import { applyMasteryChanges, type ApplyEntry } from '../services/mastery-service'
import type { SubmitResult } from '../../shared/api'
import type { AnswerRecord, Attempt, Question } from '../../shared/types'
import { readBody } from './topics'

// POST /api/topics/:id/lessons — 发起后台备课任务，立即返回 lessonId
// body.nodeId 可选：用户指定知识点（面板「学这个知识点」）；缺省走排课引擎
export async function handleCreateLesson(
  req: IncomingMessage,
  res: ServerResponse,
  topicId: string,
): Promise<void> {
  const body = (await readBody<{ nodeId?: string }>(req)) as { nodeId?: string }
  try {
    const { lessonId, reused } = startLessonJob(topicId, { nodeId: body.nodeId || undefined })
    sendJson(res, 200, { lessonId, reused })
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

// GET /api/lessons/:id/progress — SSE 挂接备课进度（回放已缓存阶段 + 直播后续）
export async function handleLessonProgress(
  _req: IncomingMessage,
  res: ServerResponse,
  lessonId: string,
): Promise<void> {
  const send = startSse(res)
  const { job, lesson } = await attachLesson(lessonId)

  if (job) {
    for (const e of job.stages) send('stage', e)
    if (job.status === 'running') {
      const finish = () => res.end()
      const unsub = subscribeJob(job, (ev) => {
        if (ev.type === 'stage') send('stage', ev.e)
        else if (ev.type === 'result') {
          send('result', { lessonId })
          finish()
        } else {
          send('error', { message: ev.message })
          finish()
        }
      })
      res.on('close', () => {
        unsub()
        finish()
      })
      return
    }
    if (job.status === 'done') send('result', { lessonId })
    else send('error', { message: job.error ?? '备课失败' })
    res.end()
    return
  }

  if (!lesson) {
    send('error', { message: '课程不存在' })
    res.end()
    return
  }
  if (lesson.status === 'generated') {
    send('result', { lessonId })
  } else {
    send('error', { message: lesson.status === 'failed' ? '上次备课失败，可重新发起' : '备课已中断，可重新发起' })
  }
  res.end()
}

// GET /api/topics/:tid/lessons/:lid — 读取课程（题目已脱敏）
export async function handleGetLesson(
  _req: IncomingMessage,
  res: ServerResponse,
  topicId: string,
  lessonId: string,
): Promise<void> {
  const detail = await getLessonDetail(topicId, lessonId)
  if (!detail) {
    sendJson(res, 404, { error: '课程不存在' })
    return
  }
  sendJson(res, 200, {
    topic: detail.topic,
    lesson: detail.lesson,
    questions: detail.questions ? stripQuestions(detail.questions) : null,
  })
}

// GET /api/lessons/:lid — 全局按 lessonId 反查（前端从备课 SSE 拿到 id 后跳转用）
export async function handleFindLesson(
  _req: IncomingMessage,
  res: ServerResponse,
  lessonId: string,
): Promise<void> {
  const detail = await findLesson(lessonId)
  if (!detail) {
    sendJson(res, 404, { error: '课程不存在' })
    return
  }
  sendJson(res, 200, {
    topic: detail.topic,
    lesson: detail.lesson,
    questions: detail.questions ? stripQuestions(detail.questions) : null,
  })
}

const submitBodySchema = z.object({
  answers: z.array(z.object({ questionId: z.string(), userAnswer: z.string() })),
})

function typeLabel(q: Question): string {
  return q.type === 'single' ? '单选' : q.type === 'judge' ? '判断' : '简答'
}

// POST /api/lessons/:id/submit — 交卷：客观题本地秒判 + 简答 LLM 批改 + 掌握分结算
export async function handleSubmitLesson(
  req: IncomingMessage,
  res: ServerResponse,
  lessonId: string,
): Promise<void> {
  const detail = await findLesson(lessonId)
  if (!detail || !detail.questions) {
    sendJson(res, 404, { error: '课程不存在' })
    return
  }
  const body = submitBodySchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: body.error.issues.map((i) => i.message).join('；') })
    return
  }

  const topicId = detail.topic.id
  const attemptFile = dataPath('topics', topicId, 'attempts', `${lessonId}.json`)
  const existing = await readJson<Attempt | null>(attemptFile, null)
  if (existing?.status === 'graded') {
    sendJson(res, 409, { error: '该课已交卷批改，不能重复提交' })
    return
  }

  const qById = new Map(detail.questions.questions.map((q) => [q.id, q]))
  const records: AnswerRecord[] = []
  const entries: ApplyEntry[] = []
  const revealed: SubmitResult['revealed'] = {}
  const results: SubmitResult['results'] = {}

  // 客观题本地秒判；简答题收集后并行 LLM 批改
  const shortTasks: Promise<void>[] = []
  for (const a of body.data.answers) {
    const q = qById.get(a.questionId)
    if (!q) continue
    revealed[q.id] = { answer: q.answer, referenceAnswer: q.referenceAnswer, explanation: q.explanation }

    if (q.type === 'short') {
      const record: AnswerRecord = { questionId: q.id, userAnswer: a.userAnswer, submittedAt: nowIso() }
      records.push(record)
      shortTasks.push(
        gradeShort(q, a.userAnswer).then((result) => {
          record.result = result
          results[q.id] = result
          entries.push({
            nodeId: q.nodeId,
            deltaInput: { type: 'short', score: result.score },
            reason: `第${q.id.slice(2)}题（简答）得分 ${result.score?.toFixed(1) ?? '?'}`,
          })
        }),
      )
    } else {
      const result = gradeObjective(q, a.userAnswer)
      results[q.id] = result
      records.push({ questionId: q.id, userAnswer: a.userAnswer, result, submittedAt: nowIso() })
      entries.push({
        nodeId: q.nodeId,
        deltaInput: { type: 'objective', correct: result.correct },
        reason: `第${q.id.slice(2)}题（${typeLabel(q)}）${result.correct ? '答对' : '答错'}`,
      })
    }
  }
  await Promise.all(shortTasks)

  const attempt: Attempt = { lessonId, records, status: 'graded' }
  await writeJson(attemptFile, attempt)

  const { changes, logs } = await applyMasteryChanges(topicId, entries)
  sendJson(res, 200, {
    lessonId,
    results,
    masteryChanges: changes,
    masteryLogs: logs,
    revealed,
  } satisfies SubmitResult)
}

// GET /api/topics/:id/lessons — 课题下全部课程列表（挂到知识点节点用）
export async function handleListLessons(
  _req: IncomingMessage,
  res: ServerResponse,
  topicId: string,
): Promise<void> {
  sendJson(res, 200, { lessons: await listLessons(topicId) })
}

const reviseBodySchema = z.object({ instruction: z.string().max(2000).optional() })

// POST /api/lessons/:id/revise — 发起课件 AI 优化任务（后台，原地覆盖）
export async function handleReviseLesson(
  req: IncomingMessage,
  res: ServerResponse,
  lessonId: string,
): Promise<void> {
  const body = reviseBodySchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: body.error.issues.map((i) => i.message).join('；') })
    return
  }
  try {
    const result = await startReviseJob(lessonId, body.data.instruction ?? '')
    sendJson(res, 200, result)
  } catch (err) {
    sendJson(res, 409, { error: err instanceof Error ? err.message : String(err) })
  }
}

// DELETE /api/lessons/:id — 删除课件（含题目与答题记录）
export async function handleDeleteLesson(
  _req: IncomingMessage,
  res: ServerResponse,
  lessonId: string,
): Promise<void> {
  const { jobsRunningFor } = await import('../services/lesson-jobs')
  if (jobsRunningFor(lessonId)) {
    sendJson(res, 409, { error: '该课程正在备课/优化中，完成后再删除' })
    return
  }
  const ok = await deleteLesson(lessonId)
  sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '课程不存在' })
}
