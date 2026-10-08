import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { sendJson } from '../index'
import { startSse } from '../sse'
import { newId, nowIso } from '../repo/json-store'
import { startLessonJob, attachLesson, subscribeJob, startReviseJob } from '../services/lesson-jobs'
import { deleteLesson, findLesson, getLessonDetail, listLessons, stripQuestions } from '../services/lesson-service'
import { gradeObjective, gradeShort } from '../services/grading-service'
import { applyMasteryChanges, type ApplyEntry } from '../services/mastery-service'
import { appendAttempt, listAttempts } from '../services/attempt-service'
import { regenerateQuestions } from '../services/lesson-agent'
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
  // 乐观并发：作答时的题集生成时间，与服务端不一致说明题目已被「再次测验」换新
  generatedAt: z.string().optional(),
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
  if (
    body.data.generatedAt &&
    detail.questions.generatedAt &&
    body.data.generatedAt !== detail.questions.generatedAt
  ) {
    sendJson(res, 409, { error: '题目已更新，请刷新页面后作答' })
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

  const { changes, logs } = await applyMasteryChanges(topicId, entries)

  // 留档：题目快照 + 作答 + 批改 + 掌握分变化，可多次测验逐条追加
  const attempt: Attempt = {
    id: newId('a'),
    lessonId,
    questions: detail.questions.questions,
    records,
    masteryChanges: changes,
    status: 'graded',
    createdAt: nowIso(),
  }
  await appendAttempt(topicId, attempt)

  sendJson(res, 200, {
    lessonId,
    results,
    masteryChanges: changes,
    masteryLogs: logs,
    revealed,
  } satisfies SubmitResult)
}

// GET /api/lessons/:lid/attempts — 该课全部测验记录（含题目快照，升序）
export async function handleListAttempts(
  _req: IncomingMessage,
  res: ServerResponse,
  lessonId: string,
): Promise<void> {
  const detail = await findLesson(lessonId)
  if (!detail) {
    sendJson(res, 404, { error: '课程不存在' })
    return
  }
  sendJson(res, 200, { attempts: await listAttempts(detail.topic.id, lessonId) })
}

// POST /api/lessons/:lid/questions/regenerate — 再次测验：LLM 重新出一套新题
export async function handleRegenerateQuestions(
  _req: IncomingMessage,
  res: ServerResponse,
  lessonId: string,
): Promise<void> {
  try {
    const questions = await regenerateQuestions(lessonId)
    sendJson(res, 200, { questions: stripQuestions(questions) })
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
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
