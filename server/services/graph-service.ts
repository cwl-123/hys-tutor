import { readFile, readdir } from 'node:fs/promises'
import { dataPath, newId, nowIso, readJson, writeJson } from '../repo/json-store'
import { completeJson, getLLMModel } from '../llm/client'
import { GRAPH_SYSTEM_PROMPT, graphUserPrompt, llmGraphSchema } from '../llm/prompts/graph'
import { repairNodes, validateGraphNodes } from '../../shared/dag'
import type { Graph, KnowledgeNode, Topic } from '../../shared/types'

const MIN_NODES = 15
const MAX_NODES = 40

function topicsFile(): string {
  return dataPath('topics.json')
}

function graphFile(topicId: string): string {
  return dataPath('topics', topicId, 'graph.json')
}

export async function listTopics(): Promise<Topic[]> {
  return readJson<Topic[]>(topicsFile(), [])
}

export async function getTopic(topicId: string): Promise<Topic | null> {
  try {
    const raw = await readFile(dataPath('topics', topicId, 'topic.json'), 'utf-8')
    return JSON.parse(raw) as Topic
  } catch {
    return null
  }
}

export async function getGraph(topicId: string): Promise<Graph | null> {
  return readJson<Graph | null>(graphFile(topicId), null)
}

function toKnowledgeNodes(llmNodes: { id: string; name: string; description: string; deps: string[] }[]) {
  return llmNodes.map<KnowledgeNode>((n) => ({
    id: n.id.trim(),
    name: n.name.trim(),
    description: n.description.trim(),
    deps: n.deps,
    mastery: 0,
    manualEdited: false,
  }))
}

// 备课主流程：LLM 生成 DAG → 校验 → 修复（去重/删悬空依赖/破环/截断）→ 不合格带 hints 重试一次
export async function createTopic(
  name: string,
  onStage: (stage: string, detail?: unknown) => void,
): Promise<{ topic: Topic; graph: Graph }> {
  onStage('generating')
  let nodes: KnowledgeNode[] = []
  let hints: string | undefined

  for (let attempt = 0; attempt < 2; attempt++) {
    const llm = await completeJson({
      system: GRAPH_SYSTEM_PROMPT,
      prompt: graphUserPrompt(name, hints),
      schema: llmGraphSchema,
    })
    nodes = repairNodes(toKnowledgeNodes(llm.nodes), MAX_NODES)

    const issues = validateGraphNodes(nodes)
    if (!issues.length && nodes.length >= MIN_NODES) break
    hints = [
      ...issues.map((i) => i.message),
      nodes.length < MIN_NODES ? `知识点只有 ${nodes.length} 个，不足 ${MIN_NODES} 个` : '',
    ]
      .filter(Boolean)
      .join('\n')
    onStage('retrying', { attempt: attempt + 1, hints })
  }

  const topic: Topic = {
    id: newId('t'),
    name,
    createdAt: nowIso(),
    llmModel: getLLMModel(),
  }
  const graph: Graph = { nodes, updatedAt: nowIso() }

  await writeJson(dataPath('topics', topic.id, 'topic.json'), topic)
  await writeJson(graphFile(topic.id), graph)
  const topics = await listTopics()
  await writeJson(topicsFile(), [...topics, topic])

  onStage('done', { topicId: topic.id, nodeCount: nodes.length })
  return { topic, graph }
}

// 手动编辑保存：全量替换节点，服务端重新校验（无环、依赖存在、掌握分合法）
export async function saveGraph(topicId: string, nodes: KnowledgeNode[]): Promise<Graph> {
  const issues = validateGraphNodes(nodes)
  if (issues.length) {
    throw Object.assign(new Error(issues.map((i) => i.message).join('；')), { status: 400 })
  }
  if (nodes.length > MAX_NODES) {
    throw Object.assign(new Error(`节点数超过上限 ${MAX_NODES}`), { status: 400 })
  }
  const graph: Graph = { nodes, updatedAt: nowIso() }
  await writeJson(graphFile(topicId), graph)
  return graph
}

// 兜底：topics.json 丢失时从目录扫描恢复
export async function recoverTopics(): Promise<Topic[]> {
  const dir = dataPath('topics')
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const topics: Topic[] = []
  for (const id of entries) {
    const topic = await getTopic(id)
    if (topic) topics.push(topic)
  }
  return topics
}
