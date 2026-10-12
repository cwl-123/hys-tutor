import type { KnowledgeNode } from './types'

export interface GraphIssue {
  code: 'cycle' | 'missing-dep' | 'dup-id' | 'self-dep' | 'count' | 'mastery' | 'few-edges'
  message: string
}

// Kahn 拓扑排序；remaining 为未能排出的节点（即环上节点）
export function kahn(nodes: KnowledgeNode[]): { order: string[]; remaining: string[] } {
  const indeg = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of nodes) {
    indeg.set(n.id, 0)
    adj.set(n.id, [])
  }
  for (const n of nodes) {
    for (const d of n.deps) {
      if (!adj.has(d) || d === n.id) continue
      adj.get(d)!.push(n.id)
      indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1)
    }
  }
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const next of adj.get(id) ?? []) {
      const left = (indeg.get(next) ?? 0) - 1
      indeg.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  const ordered = new Set(order)
  return { order, remaining: nodes.map((n) => n.id).filter((id) => !ordered.has(id)) }
}

export function hasCycle(nodes: KnowledgeNode[]): boolean {
  return kahn(nodes).remaining.length > 0
}

// 破环：反复找环上节点，删掉它指向环内其他节点的依赖边，直到无环
export function breakCycles(nodes: KnowledgeNode[]): KnowledgeNode[] {
  const map = new Map(nodes.map((n) => [n.id, { ...n, deps: [...n.deps] }]))
  for (;;) {
    const { remaining } = kahn([...map.values()])
    if (remaining.length === 0) break
    const inCycle = new Set(remaining)
    const targetId = remaining[0]
    const target = map.get(targetId)!
    const dep = target.deps.find((d) => inCycle.has(d) && d !== targetId) ?? target.deps[0]
    if (dep === undefined) break
    target.deps = target.deps.filter((d) => d !== dep)
  }
  return [...map.values()]
}

// 修复 LLM/编辑产出的图：去重 id、删自环/悬空依赖、破环、截断到上限
export function repairNodes(nodes: KnowledgeNode[], maxNodes = 40): KnowledgeNode[] {
  const seen = new Set<string>()
  const deduped: KnowledgeNode[] = []
  for (const n of nodes) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    deduped.push({ ...n, deps: [...n.deps] })
  }
  for (const n of deduped) {
    n.deps = n.deps.filter((d) => d !== n.id && seen.has(d))
  }
  const repaired = breakCycles(deduped).slice(0, maxNodes)
  // 截断后被依赖节点可能被切掉，需重新过滤一遍悬空依赖
  const kept = new Set(repaired.map((n) => n.id))
  for (const n of repaired) {
    n.deps = n.deps.filter((d) => kept.has(d))
  }
  return repaired
}

export function validateGraphNodes(nodes: KnowledgeNode[]): GraphIssue[] {
  const issues: GraphIssue[] = []
  const ids = new Set<string>()
  for (const n of nodes) {
    if (ids.has(n.id)) issues.push({ code: 'dup-id', message: `重复的节点 id：${n.id}` })
    ids.add(n.id)
  }
  for (const n of nodes) {
    if (n.deps.includes(n.id)) {
      issues.push({ code: 'self-dep', message: `${n.name} 依赖了自己` })
    }
    for (const d of n.deps) {
      if (!ids.has(d)) {
        issues.push({ code: 'missing-dep', message: `${n.name} 依赖了不存在的节点 ${d}` })
      }
    }
    if (n.mastery < 0 || n.mastery > 100) {
      issues.push({ code: 'mastery', message: `${n.name} 掌握分越界：${n.mastery}` })
    }
  }
  if (hasCycle(nodes)) issues.push({ code: 'cycle', message: '依赖关系存在环' })
  return issues
}

// 生成质量闸（仅用于 LLM 生成后的校验，手工编辑不强制）：
// 模型偶尔整图漏掉 deps，schema 默认值会把缺失字段悄悄变成 []，
// 产出一个零边"散装"图——排课退化成全部同时解锁、图谱变成一排平铺。
// 经验值：正常图谱边数 ≥ 节点数的一半（实测 0.9~1.5 条/节点）。
export function validateGraphDensity(nodes: KnowledgeNode[]): GraphIssue[] {
  const edges = nodes.reduce((acc, n) => acc + n.deps.length, 0)
  if (edges >= Math.ceil(nodes.length / 2)) return []
  return [
    {
      code: 'few-edges',
      message: `依赖边只有 ${edges} 条：除少数入门节点外，每个知识点都必须给出前置依赖 deps，构成有层次的学习路径`,
    },
  ]
}
