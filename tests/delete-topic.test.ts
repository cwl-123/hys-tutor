import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// json-store 在模块加载时读取 HYS_DATA_DIR，必须在动态 import 之前设置
const dataDir = await mkdtemp(path.join(tmpdir(), 'hys-delete-topic-'))
process.env.HYS_DATA_DIR = dataDir

const { dataPath, writeJson } = await import('../server/repo/json-store')
const { deleteTopic, getTopic, listTopics } = await import('../server/services/graph-service')
import type { Topic } from '../shared/types'

const TOPIC: Topic = { id: 't_del', name: '待删除方向', createdAt: '2026-01-01T00:00:00.000Z' }
const KEEP: Topic = { id: 't_keep', name: '保留方向', createdAt: '2026-01-01T00:00:00.000Z' }

describe('deleteTopic', () => {
  it('移除索引条目并删除该方向目录下全部数据', async () => {
    await writeJson(dataPath('topics', TOPIC.id, 'topic.json'), TOPIC)
    await writeJson(dataPath('topics', TOPIC.id, 'graph.json'), { nodes: [], updatedAt: 'x' })
    await writeJson(dataPath('topics.json'), [TOPIC, KEEP])

    expect(await deleteTopic(TOPIC.id)).toBe(true)

    expect((await listTopics()).map((t) => t.id)).toEqual(['t_keep'])
    expect(await getTopic(TOPIC.id)).toBeNull()
    await expect(access(dataPath('topics', TOPIC.id))).rejects.toThrow()
  })

  it('方向不存在返回 false，且不动索引', async () => {
    await writeJson(dataPath('topics.json'), [KEEP])
    expect(await deleteTopic('t_missing')).toBe(false)
    expect((await listTopics()).map((t) => t.id)).toEqual(['t_keep'])
  })
})