import { readFile, readdir } from 'node:fs/promises'
import { dataPath, newId, nowIso, readJson, writeJson } from '../repo/json-store'
import { completeJson, getLLMModel } from '../llm/client'
import { GRAPH_SYSTEM_PROMPT, graphUserPrompt, llmGraphSchema } from '../llm/prompts/graph'
import {
  TOPIC_RESEARCH_SYSTEM_PROMPT,
  topicResearchSchema,
  topicResearchUserPrompt,
  type TopicResearch,
} from '../llm/prompts/topic-research'
import { runAgent, type AgentTool } from '../agent/loop'
import { searchWeb } from '../agent/tools/web-search'
import { fetchPage } from '../agent/tools/web-fetch'
import { repairNodes, validateGraphNodes } from '../../shared/dag'
import type { Graph, KnowledgeNode, Topic, TopicProfile } from '../../shared/types'

const MIN_NODES = 15
const MAX_NODES = 40

function topicsFile(): string {
  return dataPath('topics.json')
}

function graphFile(topicId: string): string {
  return dataPath('topics', topicId, 'graph.json')
}

function topicResearchFile(topicId: string): string {
  return dataPath('topics', topicId, 'topic-research.json')
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

// 调研学习方向：Agent 联网搜索知识体系，保存 topic-research.json；失败降级为无调研直接生成
async function runTopicResearch(
  topicId: string,
  name: string,
  onStage: (stage: string, detail?: unknown) => void,
): Promise<TopicResearch | null> {
  onStage('researching')
  let saved: TopicResearch | null = null
  const tools: AgentTool[] = [
    {
      name: 'web_search',
      description: '联网搜索（Tavily + 博查双路合并），返回标题/URL/摘要列表',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '搜索关键词（中文或英文）' } },
        required: ['query'],
      },
      execute: async (args) => {
        const query = String(args.query ?? '').trim()
        if (!query) return '搜索词为空'
        const results = await searchWeb(query)
        return results
          .slice(0, 8)
          .map((r, i) => `[${i + 1}] (${r.provider}) ${r.title}\n${r.url}\n${r.snippet}`)
          .join('\n\n')
      },
    },
    {
      name: 'web_fetch',
      description: '抓取网页并提取正文（最长 6000 字）',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: '网页 URL' } },
        required: ['url'],
      },
      execute: async (args) => {
        const page = await fetchPage(String(args.url ?? ''))
        return `标题：${page.title}\n\n${page.text}`
      },
    },
    {
      name: 'save_topic_research',
      description: '保存调研结论（调研完成后必须调用一次）',
      parameters: {
        type: 'object',
        properties: {
          overview: { type: 'string', description: '该方向总览（100 字内）' },
          contentAreas: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, description: { type: 'string' } },
              required: ['name', 'description'],
            },
            description: '主要内容板块，按学习顺序排列（8~20 个）',
          },
          keySkills: { type: 'array', items: { type: 'string' }, description: '关键能力（3~8 条）' },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: { type: 'string' }, url: { type: 'string' } },
              required: ['title', 'url'],
            },
          },
        },
        required: ['overview', 'contentAreas', 'keySkills'],
      },
      execute: async (args) => {
        saved = topicResearchSchema.parse(args)
        await writeJson(topicResearchFile(topicId), { ...saved, researchedAt: nowIso() })
        return '调研结论已保存，可以收尾了'
      },
    },
  ]

  try {
    await runAgent({
      system: TOPIC_RESEARCH_SYSTEM_PROMPT,
      prompt: topicResearchUserPrompt(name),
      tools,
      maxRounds: 8,
      onEvent: (e) => {
        if (e.type === 'tool_call') onStage('research-tool', { tool: e.name, args: e.args })
      },
    })
  } catch (err) {
    onStage('research-failed', { message: err instanceof Error ? err.message : String(err) })
    return null
  }
  return saved
}

// 开课主流程：Agent 联网调研 → LLM 生成 DAG → 校验 → 修复 → 不合格带 hints 重试一次
export async function createTopic(
  name: string,
  onStage: (stage: string, detail?: unknown) => void,
  profile?: TopicProfile,
): Promise<{ topic: Topic; graph: Graph }> {
  const topic: Topic = {
    id: newId('t'),
    name,
    createdAt: nowIso(),
    llmModel: getLLMModel(),
    profile:
      profile && (profile.style || profile.level || profile.extra)
        ? { style: profile.style, level: profile.level, extra: profile.extra }
        : undefined,
  }

  const research = await runTopicResearch(topic.id, name, onStage)
  const researchBlock = research ? JSON.stringify(research, null, 2) : undefined

  onStage('generating')
  let nodes: KnowledgeNode[] = []
  let hints: string | undefined

  for (let attempt = 0; attempt < 2; attempt++) {
    const llm = await completeJson({
      system: GRAPH_SYSTEM_PROMPT,
      prompt: graphUserPrompt(name, researchBlock, hints, topic.profile),
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
