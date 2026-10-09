import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// json-store 在模块加载时读取 HYS_DATA_DIR，必须在动态 import 之前设置
const dataDir = await mkdtemp(path.join(tmpdir(), 'hys-jobs-'))
process.env.HYS_DATA_DIR = dataDir

interface PrepareOpts {
  nodeId?: string
  lessonId?: string
}

const prepareCalls: { topicId: string; opts: PrepareOpts }[] = []

vi.mock('../server/services/lesson-agent', () => ({
  prepareLesson: vi.fn(async (topicId: string, onStage: (e: unknown) => void, opts: PrepareOpts) => {
    prepareCalls.push({ topicId, opts })
    onStage({ stage: 'scheduled', detail: { nodeId: opts.nodeId, nodeName: 'n', reason: 'r' } })
    onStage({ stage: 'done', detail: { lessonId: opts.lessonId } })
    return { lesson: {}, questions: {} }
  }),
  reviseLesson: vi.fn(),
}))

const { startLessonJob } = await import('../server/services/lesson-jobs')

describe('startLessonJob', () => {
  it('把预分配的 lessonId 传给 prepareLesson，正文不会写到随机新文件', async () => {
    prepareCalls.length = 0
    const { lessonId, reused } = startLessonJob('t_lessonid', { nodeId: 'n1' })
    expect(reused).toBe(false)

    await vi.waitFor(() => expect(prepareCalls.length).toBe(1))
    // 关键回归：opts.lessonId 必须是任务自己的 id，而不是 undefined（否则 generate 会另起随机 id）
    expect(prepareCalls[0].opts).toEqual({ nodeId: 'n1', lessonId })

    // 占位记录异步落盘，等它出现并确认文件名就是任务自己的 id（不是随机新文件）
    const file = path.join(dataDir, 'topics', 't_lessonid', 'lessons', `${lessonId}.json`)
    await vi.waitFor(async () => {
      const raw = JSON.parse(await readFile(file, 'utf-8')) as { id: string }
      expect(raw.id).toBe(lessonId)
    })
  })

  it('同方向已有在途任务时复用同一个 lessonId', async () => {
    const first = startLessonJob('t_reuse', { nodeId: 'n1' })
    const second = startLessonJob('t_reuse', { nodeId: 'n1' })
    expect(second.reused).toBe(true)
    expect(second.lessonId).toBe(first.lessonId)
  })
})