import { kahn } from '../../shared/dag'
import { MASTERY_UNLOCK_THRESHOLD, type KnowledgeNode } from '../../shared/types'

export interface ScheduleResult {
  nodeId: string | null
  reason: string
}

// 排课规则（PRD）：前置依赖已掌握（≥80）且自身掌握分最低的知识点
// 纯函数：不读写存储，页面可直接展示 reason 解释"为什么这节课讲这个"
export function scheduleNext(nodes: KnowledgeNode[]): ScheduleResult {
  if (nodes.length === 0) return { nodeId: null, reason: '图谱为空，请先生成知识图谱' }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const isMastered = (n: KnowledgeNode | undefined) =>
    (n?.mastery ?? 0) >= MASTERY_UNLOCK_THRESHOLD

  const candidates = nodes.filter(
    (n) => n.mastery < MASTERY_UNLOCK_THRESHOLD && n.deps.every((d) => isMastered(byId.get(d))),
  )

  if (candidates.length === 0) {
    const allMastered = nodes.every((n) => n.mastery >= MASTERY_UNLOCK_THRESHOLD)
    return {
      nodeId: null,
      reason: allMastered ? '全部知识点已掌握 🎉' : '暂无已解锁的知识点（前置依赖未达标）',
    }
  }

  // 分数最低优先；同分按拓扑序靠前，再按 id 兜底，保证结果确定可复现
  const { order } = kahn(nodes)
  const topoIndex = new Map(order.map((id, i) => [id, i]))
  candidates.sort(
    (a, b) =>
      a.mastery - b.mastery ||
      (topoIndex.get(a.id) ?? 0) - (topoIndex.get(b.id) ?? 0) ||
      a.id.localeCompare(b.id),
  )
  const picked = candidates[0]

  const unlockedDesc =
    picked.deps.length === 0
      ? '无前置依赖'
      : `前置 ${picked.deps.map((d) => `${byId.get(d)?.name ?? d}=${byId.get(d)?.mastery ?? 0}`).join('、')} 均 ≥${MASTERY_UNLOCK_THRESHOLD}`
  const lowestDesc =
    candidates.length === 1
      ? `掌握分 ${picked.mastery}`
      : `在 ${candidates.length} 个已解锁知识点中掌握分最低（${picked.mastery}）`

  return {
    nodeId: picked.id,
    reason: `${picked.name}：${unlockedDesc}，且${lowestDesc}`,
  }
}
