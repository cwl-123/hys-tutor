import { describe, expect, it } from 'vitest'
import { breakCycles, hasCycle, kahn, repairNodes, validateGraphNodes } from '../shared/dag'

describe('dag', () => {
  it('无环图通过校验', () => {
    const nodes = [
      { id: 'a', name: 'A', description: '', deps: [], mastery: 0, manualEdited: false },
      { id: 'b', name: 'B', description: '', deps: ['a'], mastery: 50, manualEdited: false },
      { id: 'c', name: 'C', description: '', deps: ['a', 'b'], mastery: 100, manualEdited: false },
    ]
    expect(hasCycle(nodes)).toBe(false)
    expect(validateGraphNodes(nodes)).toEqual([])
  })

  it('检测出环', () => {
    const nodes = [
      { id: 'a', name: 'A', description: '', deps: ['c'], mastery: 0, manualEdited: false },
      { id: 'b', name: 'B', description: '', deps: ['a'], mastery: 0, manualEdited: false },
      { id: 'c', name: 'C', description: '', deps: ['b'], mastery: 0, manualEdited: false },
    ]
    expect(hasCycle(nodes)).toBe(true)
    expect(validateGraphNodes(nodes).some((i) => i.code === 'cycle')).toBe(true)
  })

  it('破环后无环且尽量少删边', () => {
    const nodes = [
      { id: 'a', name: 'A', description: '', deps: ['c'], mastery: 0, manualEdited: false },
      { id: 'b', name: 'B', description: '', deps: ['a'], mastery: 0, manualEdited: false },
      { id: 'c', name: 'C', description: '', deps: ['b'], mastery: 0, manualEdited: false },
      { id: 'd', name: 'D', description: '', deps: ['b'], mastery: 0, manualEdited: false },
    ]
    const fixed = breakCycles(nodes)
    expect(hasCycle(fixed)).toBe(false)
    const totalEdges = fixed.reduce((s, n) => s + n.deps.length, 0)
    expect(totalEdges).toBe(3) // 4 条边只删 1 条即可破环
    expect(fixed.find((n) => n.id === 'd')!.deps).toEqual(['b']) // 不在环上的边不动
  })

  it('repairNodes 去重 id、删自环与悬空依赖、截断上限', () => {
    const mk = (id: string, deps: string[]) => ({
      id,
      name: id,
      description: '',
      deps,
      mastery: 0,
      manualEdited: false,
    })
    const nodes = [
      mk('a', ['a', 'ghost']),
      mk('a', []),
      ...Array.from({ length: 45 }, (_, i) => mk(`x${i}`, [])),
    ]
    const fixed = repairNodes(nodes, 40)
    expect(fixed.length).toBeLessThanOrEqual(40)
    expect(new Set(fixed.map((n) => n.id)).size).toBe(fixed.length)
    const a = fixed.find((n) => n.id === 'a')
    if (a) expect(a.deps).toEqual([])
    expect(hasCycle(fixed)).toBe(false)
  })

  it('拓扑排序输出顺序满足依赖在前', () => {
    const nodes = [
      { id: 'c', name: 'C', description: '', deps: ['b'], mastery: 0, manualEdited: false },
      { id: 'a', name: 'A', description: '', deps: [], mastery: 0, manualEdited: false },
      { id: 'b', name: 'B', description: '', deps: ['a'], mastery: 0, manualEdited: false },
    ]
    const { order, remaining } = kahn(nodes)
    expect(remaining).toEqual([])
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'))
  })
})
