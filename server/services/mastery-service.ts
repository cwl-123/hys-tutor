import { dataPath, newId, nowIso, readJson, writeJson } from '../repo/json-store'
import { clampMastery, masteryDelta, type MasteryDeltaInput } from '../../shared/mastery'
import type { MasteryChange } from '../../shared/api'
import type { Graph, MasteryLogEntry } from '../../shared/types'

export interface ApplyEntry {
  nodeId: string
  deltaInput: MasteryDeltaInput
  reason: string
}

export interface ApplyResult {
  changes: MasteryChange[]
  logs: MasteryLogEntry[]
}

// 掌握分唯一写入口：聚合本次变更 → clamp → 写回 graph.json → append mastery-log.json
// 每次变更必写 MasteryLog（PRD：页面要能看到变化原因）
export async function applyMasteryChanges(
  topicId: string,
  entries: ApplyEntry[],
): Promise<ApplyResult> {
  const graphFile = dataPath('topics', topicId, 'graph.json')
  const graph = await readJson<Graph | null>(graphFile, null)
  if (!graph) throw new Error('图谱不存在')

  // 同节点多题变更先聚合
  const acc = new Map<string, { delta: number; reasons: string[] }>()
  for (const e of entries) {
    const d = masteryDelta(e.deltaInput)
    if (d === 0) continue
    const cur = acc.get(e.nodeId) ?? { delta: 0, reasons: [] }
    cur.delta += d
    cur.reasons.push(e.reason)
    acc.set(e.nodeId, cur)
  }

  const logFile = dataPath('topics', topicId, 'mastery-log.json')
  const history = await readJson<MasteryLogEntry[]>(logFile, [])

  const changes: MasteryChange[] = []
  const newLogs: MasteryLogEntry[] = []
  for (const [nodeId, { delta, reasons }] of acc) {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) continue
    const before = node.mastery
    const after = clampMastery(before + delta)
    const actual = after - before
    node.mastery = after
    const reason = reasons.join('；')
    changes.push({ nodeId, nodeName: node.name, before, after, delta: actual, reason })
    newLogs.push({
      id: newId('m'),
      nodeId,
      before,
      after,
      delta: actual,
      reason,
      sourceType: 'question',
      createdAt: nowIso(),
    })
  }

  if (newLogs.length > 0) {
    graph.updatedAt = nowIso()
    await writeJson(graphFile, graph)
    await writeJson(logFile, [...history, ...newLogs])
  }
  return { changes, logs: newLogs }
}
