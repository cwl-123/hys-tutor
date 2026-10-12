import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// json-store 在模块加载时读取 HYS_DATA_DIR，必须在动态 import 之前设置
const dataDir = await mkdtemp(path.join(tmpdir(), 'hys-graph-save-'))
process.env.HYS_DATA_DIR = dataDir

const { dataPath, readJson, writeJson } = await import('../server/repo/json-store')
const { saveGraph } = await import('../server/services/graph-service')
import type { Graph, KnowledgeNode } from '../shared/types'

function node(id: string, mastery: number, deps: string[] = []): KnowledgeNode {
  return { id, name: id, description: '', deps, mastery, manualEdited: true }
}

describe('saveGraph 掌握分保护', () => {
  it('客户端提交的 mastery 一律被服务端现有值覆盖（只有 mastery-service 能改分）', async () => {
    const existing: Graph = {
      updatedAt: new Date().toISOString(),
      nodes: [node('n1', 85), node('n2', 30, ['n1'])],
    }
    await writeJson(dataPath('topics', 't_gs', 'graph.json'), existing)

    // 前端手动编辑（改名字/依赖）提交全量节点，里面带着 mastery——必须被忽略
    const saved = await saveGraph('t_gs', [node('n1', 0), node('n2', 100, ['n1']), node('n3', 100, ['n2'])])
    expect(saved.nodes.find((n) => n.id === 'n1')?.mastery).toBe(85)
    expect(saved.nodes.find((n) => n.id === 'n2')?.mastery).toBe(30)
    // 新增节点默认 0 分，即使客户端报了 100
    expect(saved.nodes.find((n) => n.id === 'n3')?.mastery).toBe(0)

    const onDisk = await readJson<Graph>(dataPath('topics', 't_gs', 'graph.json'), existing)
    expect(onDisk.nodes.find((n) => n.id === 'n2')?.mastery).toBe(30)
  })

  it('结构非法（悬空依赖/自环/环）仍然拒绝', async () => {
    await writeJson(dataPath('topics', 't_gs2', 'graph.json'), {
      updatedAt: new Date().toISOString(),
      nodes: [node('n1', 0)],
    })
    await expect(saveGraph('t_gs2', [node('n1', 0, ['ghost'])])).rejects.toThrow('不存在的节点')
    await expect(saveGraph('t_gs2', [node('n1', 0, ['n2']), node('n2', 0, ['n1'])])).rejects.toThrow('环')
  })
})
