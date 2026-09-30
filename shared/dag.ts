import type { KnowledgeNode } from './types'

export interface GraphIssue {
  code: 'cycle' | 'missing-dep' | 'dup-id' | 'self-dep' | 'count' | 'mastery'
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
  return breakCycles(deduped).slice(0, maxNodes)
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
