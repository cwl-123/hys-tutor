import { describe, expect, it } from 'vitest'
import { applyGraphChanges, computeGraphDiff } from '../server/services/graph-chat-service'
import { hasCycle } from '../shared/dag'
import type { KnowledgeNode } from '../shared/types'

function node(id: string, deps: string[] = [], name = id): KnowledgeNode {
  return { id, name, description: `desc-${id}`, deps, mastery: 30, manualEdited: false }
}

const base = () => [node('a'), node('b', ['a']), node('c', ['b'])]

describe('applyGraphChanges', () => {
  it('新增节点', () => {
    const out = applyGraphChanges(base(), {
      upsert: [{ id: 'd', name: 'D', description: 'dd', deps: ['a'] }],
      delete: [],
    })
    expect(out.find((n) => n.id === 'd')).toMatchObject({ name: 'D', mastery: 0, manualEdited: true })
    expect(out).toHaveLength(4)
  })

  it('修改现有节点保留掌握分', () => {
    const out = applyGraphChanges(base(), {
      upsert: [{ id: 'b', name: 'B改', description: '新描述', deps: ['a'] }],
      delete: [],
    })
    const b = out.find((n) => n.id === 'b')!
    expect(b.name).toBe('B改')
    expect(b.mastery).toBe(30) // 掌握分不被 AI 修改
    expect(b.manualEdited).toBe(true)
  })

  it('删除节点并清理其他节点的依赖引用', () => {
    const out = applyGraphChanges(base(), { upsert: [], delete: ['b'] })
    expect(out.map((n) => n.id)).toEqual(['a', 'c'])
    expect(out.find((n) => n.id === 'c')!.deps).toEqual([])
  })

  it('AI 给出成环修改时自动破环', () => {
    const out = applyGraphChanges(base(), {
      upsert: [{ id: 'a', name: 'A', description: '', deps: ['c'] }],
      delete: [],
    })
    expect(hasCycle(out)).toBe(false)
  })

  it('悬空依赖被清理', () => {
    const out = applyGraphChanges(base(), {
      upsert: [{ id: 'd', name: 'D', description: '', deps: ['ghost', 'a'] }],
      delete: [],
    })
    expect(out.find((n) => n.id === 'd')!.deps).toEqual(['a'])
  })
})

describe('computeGraphDiff', () => {
  it('统计增删改', () => {
    const after = applyGraphChanges(base(), {
      upsert: [
        { id: 'd', name: 'D', description: '', deps: [] },
        { id: 'b', name: 'B改', description: 'desc-b', deps: ['a'] },
      ],
      delete: ['c'],
    })
    const diff = computeGraphDiff(base(), after)
    expect(diff.added).toEqual(['D'])
    expect(diff.removed).toEqual(['c'])
    expect(diff.modified).toEqual(['B改'])
  })
})
