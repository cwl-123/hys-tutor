import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// json-store 在模块加载时读取 HYS_DATA_DIR，必须在动态 import 之前设置
const dataDir = await mkdtemp(path.join(tmpdir(), 'hys-mastery-'))
process.env.HYS_DATA_DIR = dataDir

const { dataPath, readJson, writeJson } = await import('../server/repo/json-store')
const { applyMasteryChanges } = await import('../server/services/mastery-service')
import type { Graph, MasteryLogEntry } from '../shared/types'

function makeGraph(mastery: number): Graph {
  return {
    updatedAt: new Date().toISOString(),
    nodes: [
      { id: 'n1', name: '逻辑回归', description: '', deps: [], mastery, manualEdited: false },
      { id: 'n2', name: '特征工程', description: '', deps: ['n1'], mastery: 0, manualEdited: false },
    ],
  }
}

async function seedGraph(topicId: string, mastery: number) {
  await writeJson(dataPath('topics', topicId, 'graph.json'), makeGraph(mastery))
}

describe('applyMasteryChanges', () => {
  it('答对加分并写 MasteryLog（含原因）', async () => {
    await seedGraph('t_m1', 50)
    const { changes, logs } = await applyMasteryChanges('t_m1', [
      { nodeId: 'n1', deltaInput: { type: 'objective', correct: true }, reason: '第1题（单选）答对' },
    ])
    expect(changes).toHaveLength(1)
    expect(changes[0].before).toBe(50)
    expect(changes[0].after).toBe(70)
    expect(logs).toHaveLength(1)
    expect(logs[0].reason).toContain('答对')

    const graph = await readJson<Graph>(dataPath('topics', 't_m1', 'graph.json'), makeGraph(0))
    expect(graph.nodes[0].mastery).toBe(70)
    const history = await readJson<MasteryLogEntry[]>(dataPath('topics', 't_m1', 'mastery-log.json'), [])
    expect(history).toHaveLength(1)
  })

  it('同节点多条变更先聚合再 clamp；越界截断到 0-100', async () => {
    await seedGraph('t_m2', 95)
    const { changes } = await applyMasteryChanges('t_m2', [
      { nodeId: 'n1', deltaInput: { type: 'objective', correct: true }, reason: '第1题答对' },
      { nodeId: 'n1', deltaInput: { type: 'objective', correct: true }, reason: '第2题答对' },
    ])
    expect(changes).toHaveLength(1)
    expect(changes[0].after).toBe(100)
    expect(changes[0].delta).toBe(5)
  })

  it('并发结算不丢更新、不丢日志（withLock 串行化）', async () => {
    await seedGraph('t_m3', 50)
    await Promise.all([
      applyMasteryChanges('t_m3', [
        { nodeId: 'n1', deltaInput: { type: 'objective', correct: true }, reason: 'A 卷第1题答对' },
      ]),
      applyMasteryChanges('t_m3', [
        { nodeId: 'n1', deltaInput: { type: 'objective', correct: true }, reason: 'B 卷第1题答对' },
      ]),
    ])
    const graph = await readJson<Graph>(dataPath('topics', 't_m3', 'graph.json'), makeGraph(0))
    // 无锁时后写覆盖先写，只得 70；串行化后必须累计到 90
    expect(graph.nodes[0].mastery).toBe(90)
    const history = await readJson<MasteryLogEntry[]>(dataPath('topics', 't_m3', 'mastery-log.json'), [])
    expect(history).toHaveLength(2)
    expect(history.map((l) => l.reason).join()).toContain('A 卷')
    expect(history.map((l) => l.reason).join()).toContain('B 卷')
  })

  it('图谱不存在时报错；未知节点跳过不崩', async () => {
    await expect(applyMasteryChanges('t_not_exist', [])).rejects.toThrow('图谱不存在')
    await seedGraph('t_m4', 50)
    const { changes, logs } = await applyMasteryChanges('t_m4', [
      { nodeId: 'ghost', deltaInput: { type: 'objective', correct: true }, reason: 'x' },
    ])
    expect(changes).toHaveLength(0)
    expect(logs).toHaveLength(0)
  })
})
