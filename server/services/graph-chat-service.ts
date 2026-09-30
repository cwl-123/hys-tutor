import { completeJson } from '../llm/client'
import { GRAPH_CHAT_SYSTEM_PROMPT, graphChatUserPrompt, llmGraphEditSchema, type LlmGraphEdit } from '../llm/prompts/graph-chat'
import { repairNodes } from '../../shared/dag'
import { getGraph } from './graph-service'
import type { KnowledgeNode } from '../../shared/types'

export interface GraphDiff {
  added: string[]
  removed: string[]
  modified: string[]
}

export interface GraphChatResult {
  reply: string
  proposal?: { nodes: KnowledgeNode[] }
  diff?: GraphDiff
}

export type GraphChanges = NonNullable<LlmGraphEdit['changes']>

// 应用 LLM 提出的修改：先删（连带清理 deps 引用）再 upsert，最后统一修复（清悬空依赖/破环）
export function applyGraphChanges(nodes: KnowledgeNode[], changes: GraphChanges): KnowledgeNode[] {
  const del = new Set(changes.delete)
  const out: KnowledgeNode[] = nodes
    .filter((n) => !del.has(n.id))
    .map((n) => ({ ...n, deps: n.deps.filter((d) => !del.has(d)) }))

  for (const u of changes.upsert) {
    const existing = out.find((n) => n.id === u.id)
    if (existing) {
      existing.name = u.name.trim() || existing.name
      existing.description = u.description.trim()
      existing.deps = [...u.deps]
      existing.manualEdited = true
    } else {
      out.push({
        id: u.id.trim(),
        name: u.name.trim(),
        description: u.description.trim(),
        deps: [...u.deps],
        mastery: 0,
        manualEdited: true,
      })
    }
  }
  return repairNodes(out)
}

export function computeGraphDiff(before: KnowledgeNode[], after: KnowledgeNode[]): GraphDiff {
  const beforeById = new Map(before.map((n) => [n.id, n]))
  const afterById = new Map(after.map((n) => [n.id, n]))
  const added: string[] = []
  const modified: string[] = []
  for (const n of after) {
    const old = beforeById.get(n.id)
    if (!old) added.push(n.name)
    else if (
      old.name !== n.name ||
      old.description !== n.description ||
      old.deps.join(',') !== n.deps.join(',')
    ) {
      modified.push(n.name)
    }
  }
  const removed = before.filter((n) => !afterById.has(n.id)).map((n) => n.name)
  return { added, removed, modified }
}

// 图谱对话式调整：LLM 基于当前图谱产出修改建议（不落盘，前端确认后走 PATCH graph 保存）
export async function chatGraphEdit(
  topicId: string,
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<GraphChatResult> {
  const graph = await getGraph(topicId)
  if (!graph) throw Object.assign(new Error('图谱不存在'), { status: 404 })

  const result = await completeJson({
    system: GRAPH_CHAT_SYSTEM_PROMPT,
    prompt: graphChatUserPrompt(graph.nodes, message, history.slice(-6)),
    schema: llmGraphEditSchema,
  })

  const changes = result.changes
  if (!changes || (changes.upsert.length === 0 && changes.delete.length === 0)) {
    return { reply: result.reply }
  }

  const proposed = applyGraphChanges(graph.nodes, changes)
  return { reply: result.reply, proposal: { nodes: proposed }, diff: computeGraphDiff(graph.nodes, proposed) }
}
