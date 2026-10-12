import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// json-store 在模块加载时读取 HYS_DATA_DIR，必须在动态 import 之前设置
const dataDir = await mkdtemp(path.join(tmpdir(), 'hys-attempt-'))
process.env.HYS_DATA_DIR = dataDir

const { appendAttempt, listAttempts } = await import('../server/services/attempt-service')
const { addReport, listReports } = await import('../server/services/report-service')
import type { Attempt } from '../shared/types'

function makeAttempt(id: string, lessonId: string, createdAt: string): Attempt {
  return {
    id,
    lessonId,
    questions: [],
    records: [{ questionId: 'q_1', userAnswer: 'B', result: { correct: true, gradedBy: 'local' }, submittedAt: createdAt }],
    masteryChanges: [],
    status: 'graded',
    createdAt,
  }
}

describe('appendAttempt / listAttempts', () => {
  it('并发追加不丢记录（withLock 串行化）', async () => {
    await Promise.all([
      appendAttempt('t_at', makeAttempt('a_1', 'l_1', '2026-10-12T10:00:00Z')),
      appendAttempt('t_at', makeAttempt('a_2', 'l_1', '2026-10-12T11:00:00Z')),
    ])
    const list = await listAttempts('t_at', 'l_1')
    expect(list.map((a) => a.id).sort()).toEqual(['a_1', 'a_2'])
  })

  it('按时间升序返回', async () => {
    const list = await listAttempts('t_at', 'l_1')
    expect(list[0].createdAt < list[1].createdAt).toBe(true)
  })

  it('无记录返回空数组', async () => {
    await expect(listAttempts('t_at', 'l_ghost')).resolves.toEqual([])
  })
})

describe('addReport / listReports', () => {
  it('并发报错不丢记录；questionId 决定 targetType', async () => {
    await Promise.all([
      addReport('t_rp', { lessonId: 'l_1', nodeId: 'n1', questionId: 'q_1', quote: '题干有误' }),
      addReport('t_rp', { lessonId: 'l_1', nodeId: 'n1', quote: '正文有错', note: '  补充说明  ' }),
    ])
    const reports = await listReports('t_rp')
    expect(reports).toHaveLength(2)
    expect(reports.find((r) => r.targetId === 'q_1')?.targetType).toBe('question')
    expect(reports.find((r) => r.targetId === 'l_1')?.targetType).toBe('lesson')
    expect(reports.find((r) => r.targetId === 'l_1')?.note).toBe('补充说明')
  })
})
