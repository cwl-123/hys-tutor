import { dataPath, nowIso, readJson, writeJson } from '../repo/json-store'
import { prepareLesson, reviseLesson, type StageEvent } from './lesson-agent'
import type { Lesson, LessonStatus } from '../../shared/types'

// 备课后台任务：发起即返回 lessonId，进度缓存在内存供任意客户端挂接回放
interface JobListener {
  (ev: { type: 'stage'; e: StageEvent } | { type: 'result' } | { type: 'error'; message: string }): void
}

interface Job {
  topicId: string
  lessonId: string
  stages: StageEvent[]
  status: 'running' | 'done' | 'failed'
  error?: string
  listeners: Set<JobListener>
}

const jobsByLesson = new Map<string, Job>()
const runningByTopic = new Map<string, Job>()

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
  const lesson = await readJson<Lesson | null>(lessonFile(topicId, lessonId), null)
  if (!lesson) return
  // 迟到的状态回写不得覆盖已落盘的成品（防止并发写入把正文冲成空占位）
  if (lesson.status === 'generated') return
  lesson.status = status
  lesson.error = error
  await writeJson(lessonFile(topicId, lessonId), lesson)
}

function emit(job: Job, ev: Parameters<JobListener>[0]) {
  for (const l of [...job.listeners]) l(ev)
}

// 发起备课任务；同课题已有在途任务则复用
export function startLessonJob(
  topicId: string,
  opts: { nodeId?: string; lessonId?: string } = {},
): { lessonId: string; reused: boolean } {
  const existing = runningByTopic.get(topicId)
  if (existing) return { lessonId: existing.lessonId, reused: true }

  const lessonId = opts.lessonId ?? `l_${Math.random().toString(36).slice(2, 10)}`
  const job: Job = { topicId, lessonId, stages: [], status: 'running', listeners: new Set() }
  jobsByLesson.set(lessonId, job)
  runningByTopic.set(topicId, job)

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
  void writeJson(lessonFile(topicId, lessonId), initial)

  void (async () => {
    try {
      await prepareLesson(topicId, (e) => {
        job.stages.push(e)
        emit(job, { type: 'stage', e })
        const status = STAGE_TO_STATUS[e.stage]
        if (status) void patchLessonStatus(topicId, lessonId, status)
      }, { ...opts, lessonId })
      job.status = 'done'
      emit(job, { type: 'result' })
    } catch (err) {
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : String(err)
      console.error(`[lesson-job] 备课失败 ${lessonId}:`, err)
      await patchLessonStatus(topicId, lessonId, 'failed', job.error).catch(() => {})
      emit(job, { type: 'error', message: job.error })
    } finally {
      runningByTopic.delete(topicId)
      // 进度缓存保留 10 分钟供回连回放，之后释放
      setTimeout(() => jobsByLesson.delete(lessonId), 10 * 60_000)
    }
  })()

  return { lessonId, reused: false }
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
  const running = jobsByLesson.get(lessonId)
  if (running && running.status === 'running') return { lessonId, reused: true }

  const { findLesson } = await import('./lesson-service')
  const detail = await findLesson(lessonId)
  if (!detail) throw new Error('课程不存在')
  if (detail.lesson.status !== 'generated') throw new Error('仅生成完成的课程可以优化')
  const topicId = detail.topic.id

  const job: Job = { topicId, lessonId, stages: [], status: 'running', listeners: new Set() }
  jobsByLesson.set(lessonId, job)
  runningByTopic.set(topicId, job)
  await patchLessonStatus(topicId, lessonId, 'revising')

  void (async () => {
    try {
      await reviseLesson(lessonId, instruction, (e) => {
        job.stages.push(e)
        emit(job, { type: 'stage', e })
        const status = STAGE_TO_STATUS[e.stage]
        if (status) void patchLessonStatus(topicId, lessonId, status)
      })
      job.status = 'done'
      emit(job, { type: 'result' })
    } catch (err) {
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : String(err)
      console.error(`[lesson-job] 优化失败 ${lessonId}:`, err)
      // 优化失败保留原课程内容
      await patchLessonStatus(topicId, lessonId, 'generated', job.error).catch(() => {})
      emit(job, { type: 'error', message: job.error })
    } finally {
      runningByTopic.delete(topicId)
      setTimeout(() => jobsByLesson.delete(lessonId), 10 * 60_000)
    }
  })()

  return { lessonId, reused: false }
}

// 挂接任务：返回内存任务（可回放）或落盘课程（已结束/僵尸）
export async function attachLesson(lessonId: string): Promise<AttachResult> {
  const job = jobsByLesson.get(lessonId)
  if (job) return { job, lesson: null }

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
  return jobsByLesson.get(lessonId)?.status === 'running'
}

// 该方向是否有后台备课/优化任务在跑（首页/图谱据此提示「课件生成中」）
export function topicJobRunning(topicId: string): boolean {
  return runningByTopic.get(topicId)?.status === 'running'
}
