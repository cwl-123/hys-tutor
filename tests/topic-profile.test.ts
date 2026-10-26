import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// json-store 在模块加载时读取 HYS_DATA_DIR，必须在动态 import 之前设置
const dataDir = await mkdtemp(path.join(tmpdir(), 'hys-topic-profile-'))
process.env.HYS_DATA_DIR = dataDir

vi.mock('../server/llm/client', () => ({
  completeJson: vi.fn(),
  getLLMModel: () => 'test-model',
}))

const { getTopic, listTopics, updateTopicProfile } = await import(
  '../server/services/graph-service'
)
const { writeJson, dataPath } = await import('../server/repo/json-store')

const TOPIC = { id: 't_1', name: '测试课题', createdAt: '2026-01-01T00:00:00.000Z' }

beforeEach(async () => {
  await writeJson(dataPath('topics', TOPIC.id, 'topic.json'), TOPIC)
  await writeJson(dataPath('topics.json'), [TOPIC])
})

describe('updateTopicProfile', () => {
  it('写入偏好并同步 topics.json 索引', async () => {
    const updated = await updateTopicProfile(TOPIC.id, { style: '通俗直观', level: '完全新手' })
    expect(updated.profile).toEqual({ style: '通俗直观', level: '完全新手' })

    expect((await getTopic(TOPIC.id))?.profile?.style).toBe('通俗直观')
    expect((await listTopics())[0].profile?.level).toBe('完全新手')
  })

  it('全部留空则清除 profile', async () => {
    await updateTopicProfile(TOPIC.id, { style: '实战代码' })
    await updateTopicProfile(TOPIC.id, {})
    expect((await getTopic(TOPIC.id))?.profile).toBeUndefined()

    const raw = await getTopic(TOPIC.id)
    expect(raw && 'profile' in raw).toBe(false)
  })

  it('课题不存在时抛出 404', async () => {
    await expect(updateTopicProfile('t_missing', {})).rejects.toMatchObject({ status: 404 })
  })
})