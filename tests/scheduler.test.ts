import { describe, expect, it } from 'vitest'
import { scheduleNext } from '../server/services/scheduler'
import type { KnowledgeNode } from '../shared/types'

function node(id: string, mastery: number, deps: string[] = []): KnowledgeNode {
  return { id, name: id, description: '', deps, mastery, manualEdited: false }
}

describe('scheduleNext', () => {
  it('空图谱返回 null', () => {
    const r = scheduleNext([])
    expect(r.nodeId).toBeNull()
  })

  it('初始状态选拓扑序最靠前的根节点（同分 0）', () => {
    const nodes = [node('b', 0), node('a', 0), node('c', 0, ['a', 'b'])]
    const r = scheduleNext(nodes)
    expect(r.nodeId).toBe('b') // 同分按拓扑序（Kahn 随输入序），确定可复现
    expect(scheduleNext(nodes).nodeId).toBe(r.nodeId)
    expect(scheduleNext([...nodes].reverse()).nodeId).toBe('a') // 输入序变化则拓扑序变化，仍确定
  })

  it('选已解锁且分最低的节点', () => {
    const nodes = [
      node('root', 90),
      node('easy', 70, ['root']),
      node('hard', 20, ['root']),
      node('deeper', 10, ['hard']),
    ]
    const r = scheduleNext(nodes)
    expect(r.nodeId).toBe('hard') // deeper 分更低但未解锁
    expect(r.reason).toContain('hard')
    expect(r.reason).toContain('20')
  })

  it('依赖未全部达标则不解锁', () => {
    const nodes = [node('a', 90), node('b', 79), node('c', 0, ['a', 'b'])]
    const r = scheduleNext(nodes)
    expect(r.nodeId).toBe('b') // c 被 b=79 卡住
  })

  it('全部掌握返回完成', () => {
    const r = scheduleNext([node('a', 80), node('b', 100, ['a'])])
    expect(r.nodeId).toBeNull()
    expect(r.reason).toContain('全部知识点已掌握')
  })

  it('已掌握的节点不再被选中', () => {
    const nodes = [node('a', 100), node('b', 50)]
    expect(scheduleNext(nodes).nodeId).toBe('b')
  })

  it('根节点 reason 说明无前置依赖', () => {
    const r = scheduleNext([node('a', 30)])
    expect(r.reason).toContain('无前置依赖')
  })

  it('多个候选时 reason 说明是最低分', () => {
    const nodes = [node('a', 30), node('b', 60)]
    const r = scheduleNext(nodes)
    expect(r.nodeId).toBe('a')
    expect(r.reason).toContain('最低')
  })
})
