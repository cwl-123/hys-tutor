import dagre from 'dagre'
import type { KnowledgeNode } from '@shared/types'

export const NODE_WIDTH = 200
export const NODE_HEIGHT = 64

// dagre 自动布局（自上而下），返回各节点左上角坐标
export function layoutGraph(nodes: KnowledgeNode[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 72 })

  const ids = new Set(nodes.map((n) => n.id))
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const n of nodes) {
    for (const d of n.deps) {
      if (ids.has(d) && d !== n.id) g.setEdge(d, n.id)
    }
  }
  dagre.layout(g)

  const positions = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    const p = g.node(n.id)
    positions.set(n.id, { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 })
  }
  return positions
}
