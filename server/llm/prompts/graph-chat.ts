import { z } from 'zod'
import type { KnowledgeNode } from '../../../shared/types'

export const llmGraphEditSchema = z.object({
  reply: z.string().describe('给用户的自然语言回复，说明做了什么调整或为什么不建议调整'),
  changes: z
    .object({
      upsert: z
        .array(
          z.object({
            id: z.string().describe('修改现有节点用原 id；新增节点用新的 snake_case 英文 id'),
            name: z.string(),
            description: z.string(),
            deps: z.array(z.string()),
          }),
        )
        .default([]),
      delete: z.array(z.string()).default([]),
    })
    .optional()
    .describe('图谱修改；纯咨询或无需修改时省略'),
})
export type LlmGraphEdit = z.infer<typeof llmGraphEditSchema>

export const GRAPH_CHAT_SYSTEM_PROMPT = `你是知识图谱调整助手。用户会针对当前知识点图谱提出调整诉求（增删节点、改依赖、拆分/合并知识点、咨询学习路径等）。

规则：
1. 需要修改图谱时输出 changes：upsert 数组（修改现有节点必须带原 id；新增节点自拟 snake_case id，mastery 由系统置 0）+ delete 数组（要删除的节点 id）
2. upsert 的每个节点必须给全 name/description/deps 完整信息（修改现有节点时未提及的字段保持原值）
3. 修改后的图谱必须仍是无环 DAG，deps 只能引用修改后仍存在的节点 id；删除节点时其他节点的 deps 引用会被系统自动清理
4. 节点总数保持 15~40；不要动与诉求无关的节点
5. 纯咨询（如"接下来学什么"）只输出 reply，省略 changes
6. reply 用中文简要说明你做的调整（或答复咨询）
7. 只输出合法 JSON：{"reply": "...", "changes": {"upsert": [...], "delete": [...]}}`

export function graphChatUserPrompt(
  nodes: KnowledgeNode[],
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): string {
  const simplified = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    description: n.description,
    deps: n.deps,
    mastery: n.mastery,
  }))
  const historyBlock = history.length
    ? `\n\n对话历史（仅供理解上下文，图谱以下方当前数据为准）：\n${history
        .map((h) => `${h.role === 'user' ? '用户' : '助手'}：${h.content.slice(0, 500)}`)
        .join('\n')}`
    : ''
  return `当前图谱（JSON）：
${JSON.stringify(simplified, null, 2)}
${historyBlock}

用户诉求：${message}`
}
