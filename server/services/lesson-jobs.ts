import { dataPath, nowIso, readJson, withLock, writeJson } from '../repo/json-store'
import { currentUserId, runAsUser as withUser } from '../repo/context'
import { assertGlobalBudget, consumeQuota } from './quota-service'
import { errMsg } from '../../shared/error'
import { scheduleNext } from '../../shared/scheduler'
import { prepareLesson, reviseLesson, type StageEvent } from './lesson-agent'
import type { Lesson, LessonStatus } from '../../shared/types'

// 备课后台任务：发起即返回 lessonId，进度缓存在内存供任意客户端挂接回放
interface JobListener {
  (ev: { type: 'stage'; e: StageEvent } | { type: 'result' } | { type: 'error'; message: string }): void
}

interface Job {
  userId: string
  topicId: string
  lessonId: string
  stages: StageEvent[]
  status: 'running' | 'done' | 'failed'
  error?: string
  listeners: Set<JobListener>
}

const jobsByLesson = new Map<string, Job>()
const runningByTopic = new Map<string, Job>()

function topicKey(userId: string, topicId: string): string {
  return `${userId}:${topicId}`
}

// 任务级看门狗：LLM 调用挂起时（OpenAI SDK 默认超时约 10 分钟且无上限保证）
// 不能让 runningByTopic 永远被占——超时后标记失败并释放，允许用户重新发起
const JOB_TIMEOUT_MS = 10 * 60_000

function armWatchdog(job: Job, onTimeout: () => Promise<void>): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    if (job.status !== 'running') return
    job.status = 'failed'
    job.error = '任务超时（超过 10 分钟无响应），已终止，请重新发起'
    console.error(`[lesson-job] 看门狗超时 ${job.lessonId}`)
    void onTimeout().catch(() => {})
    if (runningByTopic.get(topicKey(job.userId, job.topicId)) === job) {
      runningByTopic.delete(topicKey(job.userId, job.topicId))
    }
    emit(job, { type: 'error', message: job.error })
    setTimeout(() => jobsByLesson.delete(job.lessonId), 10 * 60_000)
  }, JOB_TIMEOUT_MS)
}

const STAGE_TO_STATUS: Record<string, LessonStatus> = {
  schedule: 'researching',
  researching: 'researching',
  outline: 'outlining',
  write: 'writing',
  revise: 'revising',
  'self-check': 'self-checking',
}

function lessonFile(topicId: string, lessonId: string): string {
  return dataPath('topics', topicId, 'lessons', `${lessonId}.json`)
}

async function patchLessonStatus(
  topicId: string,
  lessonId: string,
  status: LessonStatus,
  error?: string,
): Promise<void> {
  const file = lessonFile(topicId, lessonId)
  // 读-判-写全程持锁（与 lesson-agent 成品落盘共用同一把锁），
  // 否则迟到的状态回写可能在成品写入的间隙把正文冲成空占位
  await withLock(file, async () => {
    const lesson = await readJson<Lesson | null>(file, null)
    if (!lesson) return
    if (lesson.status === 'generated') return
    lesson.status = status
    lesson.error = error
    await writeJson(file, lesson)
  })
}

function emit(job: Job, ev: Parameters<JobListener>[0]) {
  for (const l of [...job.listeners]) l(ev)
}

// 自动排课落点：排出的知识点若已有生成完成的课件，返回该课件 id（供「继续学习」直接复用）
async function findScheduledReusableLesson(topicId: string): Promise<string | null> {
  const [{ getGraph }, { listLessons }] = await Promise.all([
    import('./graph-service'),
    import('./lesson-service'),
  ])
  const graph = await getGraph(topicId)
  if (!graph) return null
  const sched = scheduleNext(graph.nodes)
  if (!sched.nodeId) return null
  const hit = (await listLessons(topicId)).find(
    (l) => l.status === 'generated' && l.nodeIds.includes(sched.nodeId!),
  )
  return hit?.id ?? null
}

// 发起备课任务；同课题已有在途任务则复用
// existing=true 表示未新建任务，而是复用了该知识点已有的课件（前端据此直接进入学习）
export async function startLessonJob(
  topicId: string,
  opts: { nodeId?: string; lessonId?: string } = {},
): Promise<{ lessonId: string; reused: boolean; existing: boolean }> {
  const userId = currentUserId()
  const running = runningByTopic.get(topicKey(userId, topicId))
  if (running) return { lessonId: running.lessonId, reused: true, existing: false }

  // 未指定知识点（排课引擎自动选题）：该知识点已有课件时直接复用，避免重复备课
  if (!opts.nodeId) {
    const reusable = await findScheduledReusableLesson(topicId)
    if (reusable) return { lessonId: reusable, reused: true, existing: true }
  }

  assertGlobalBudget()
  consumeQuota(userId, 'lesson')
  const lessonId = opts.lessonId ?? `l_${Math.random().toString(36).slice(2, 10)}`
  const job: Job = {
    userId,
    topicId,
    lessonId,
    stages: [],
    status: 'running',
    listeners: new Set(),
  }
  jobsByLesson.set(lessonId, job)
  runningByTopic.set(topicKey(userId, topicId), job)

  // 立即落盘一条 generating 记录：列表可见、可回连、崩溃后可识别僵尸
  const initial: Lesson = {
    id: lessonId,
    topicId,
    nodeIds: opts.nodeId ? [opts.nodeId] : [],
    scheduleReason: '备课任务已创建…',
    masterySnapshot: {},
    injectedReports: [],
    researchNoteIds: [],
    sources: [],
    contentMd: '',
    status: 'researching',
    createdAt: nowIso(),
  }
  // 必须落盘完成再返回：否则客户端拿到 lessonId 后立刻跳转/读取，会因文件尚未存在而报「课程不存在」
  try {
    await writeJson(lessonFile(topicId, lessonId), initial)
  } catch (err) {
    job.status = 'failed'
    jobsByLesson.delete(lessonId)
    runningByTopic.delete(topicKey(job.userId, job.topicId))
    throw err
  }

  const watchdog = armWatchdog(job, () =>
    withUser(job.userId, () => patchLessonStatus(topicId, lessonId, 'failed', job.error)),
  )

  void withUser(userId, async () => {
    try {
      await prepareLesson(topicId, (e) => {
        job.stages.push(e)
        emit(job, { type: 'stage', e })
        const status = STAGE_TO_STATUS[e.stage]
        if (status) void patchLessonStatus(topicId, lessonId, status).catch(() => {})
      }, { ...opts, lessonId })
      // 看门狗已先判超时：结果丢弃，不再改状态（成品落盘由 prepareLesson 自己完成，不受影响）
      if (job.status !== 'running') return
      job.status = 'done'
      emit(job, { type: 'result' })
    } catch (err) {
      if (job.status !== 'running') return
      job.status = 'failed'
      job.error = errMsg(err)
      console.error(`[lesson-job] 备课失败 ${lessonId}:`, err)
      await patchLessonStatus(topicId, lessonId, 'failed', job.error).catch(() => {})
      emit(job, { type: 'error', message: job.error })
    } finally {
      clearTimeout(watchdog)
      if (runningByTopic.get(topicKey(job.userId, job.topicId)) === job) {
        runningByTopic.delete(topicKey(job.userId, job.topicId))
      }
      // 进度缓存保留 10 分钟供回连回放，之后释放
      setTimeout(() => jobsByLesson.delete(lessonId), 10 * 60_000)
    }
  })

  return { lessonId, reused: false, existing: false }
}

export interface AttachResult {
  job: Job | null
  lesson: Lesson | null
}

// 发起课件优化任务（原地覆盖该课程）
export async function startReviseJob(
  lessonId: string,
  instruction: string,
): Promise<{ lessonId: string; reused: boolean }> {
  const userId = currentUserId()
  const running = jobsByLesson.get(lessonId)
  if (running && running.userId === userId && running.status === 'running') {
    return { lessonId, reused: true }
  }

  const { findLesson } = await import('./lesson-service')
  const detail = await findLesson(lessonId)
  if (!detail) throw new Error('课程不存在')
  if (detail.lesson.status !== 'generated') throw new Error('仅生成完成的课程可以优化')
  const topicId = detail.topic.id
  // 同课题已有备课任务在跑时不允许并发优化：两者都会写 taught.json / 占用 runningByTopic
  const topicRunning = runningByTopic.get(topicKey(userId, topicId))
  if (topicRunning && topicRunning.status === 'running') {
    throw new Error('该方向有备课任务进行中，完成后再试')
  }

  assertGlobalBudget()
  consumeQuota(userId, 'lesson')
  const job: Job = {
    userId,
    topicId,
    lessonId,
    stages: [],
    status: 'running',
    listeners: new Set(),
  }
  jobsByLesson.set(lessonId, job)
  runningByTopic.set(topicKey(userId, topicId), job)
  try {
    await patchLessonStatus(topicId, lessonId, 'revising')
  } catch (err) {
    job.status = 'failed'
    jobsByLesson.delete(lessonId)
    runningByTopic.delete(topicKey(job.userId, job.topicId))
    throw err
  }

  const watchdog = armWatchdog(job, () =>
    withUser(job.userId, () => patchLessonStatus(topicId, lessonId, 'generated', job.error)),
  )

  void withUser(userId, async () => {
    try {
      await reviseLesson(lessonId, instruction, (e) => {
        job.stages.push(e)
        emit(job, { type: 'stage', e })
        const status = STAGE_TO_STATUS[e.stage]
        if (status) void patchLessonStatus(topicId, lessonId, status).catch(() => {})
      })
      if (job.status !== 'running') return
      job.status = 'done'
      emit(job, { type: 'result' })
    } catch (err) {
      if (job.status !== 'running') return
      job.status = 'failed'
      job.error = errMsg(err)
      console.error(`[lesson-job] 优化失败 ${lessonId}:`, err)
      // 优化失败保留原课程内容
      await patchLessonStatus(topicId, lessonId, 'generated', job.error).catch(() => {})
      emit(job, { type: 'error', message: job.error })
    } finally {
      clearTimeout(watchdog)
      if (runningByTopic.get(topicKey(job.userId, job.topicId)) === job) {
        runningByTopic.delete(topicKey(job.userId, job.topicId))
      }
      setTimeout(() => jobsByLesson.delete(lessonId), 10 * 60_000)
    }
  })

  return { lessonId, reused: false }
}

// 挂接任务：返回内存任务（可回放）或落盘课程（已结束/僵尸）
export async function attachLesson(lessonId: string): Promise<AttachResult> {
  const job = jobsByLesson.get(lessonId)
  if (job) {
    if (job.userId !== currentUserId()) return { job: null, lesson: null }
    return { job, lesson: null }
  }

  // 无内存任务：查落盘记录
  const { findLesson } = await import('./lesson-service')
  const detail = await findLesson(lessonId)
  if (!detail) return { job: null, lesson: null }
  const lesson = detail.lesson

  // 僵尸任务（服务重启导致在途备课中断）：标记 failed，允许重新发起
  if (lesson.status !== 'generated' && lesson.status !== 'failed') {
    lesson.status = 'failed'
    await writeJson(lessonFile(detail.topic.id, lessonId), lesson)
  }
  return { job: null, lesson }
}

export function subscribeJob(job: Job, listener: JobListener): () => void {
  job.listeners.add(listener)
  return () => job.listeners.delete(listener)
}

export function jobsRunningFor(lessonId: string): boolean {
  const job = jobsByLesson.get(lessonId)
  return !!job && job.userId === currentUserId() && job.status === 'running'
}

// 该方向是否有后台备课/优化任务在跑（首页/图谱据此提示「课件生成中」）
export function topicJobRunning(topicId: string): boolean {
  return runningByTopic.get(topicKey(currentUserId(), topicId))?.status === 'running'
}
