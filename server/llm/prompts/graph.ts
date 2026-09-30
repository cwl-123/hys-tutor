import { z } from 'zod'

export const llmGraphNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  deps: z.array(z.string()).default([]),
})

export const llmGraphSchema = z.object({
  nodes: z.array(llmGraphNodeSchema).min(5),
})

export const GRAPH_SYSTEM_PROMPT = `你是一位资深的课程架构师，擅长把技术领域拆解为循序渐进的知识点学习路径。
你只输出合法 JSON，不输出任何解释、前后缀或 markdown 围栏之外的内容。`

export function graphUserPrompt(topicName: string, research?: string, retryHints?: string): string {
  const researchBlock = research
    ? `\n\n联网调研结论（生成图谱的主要依据，内容板块尽量覆盖）：\n${research}`
    : ''
  const hints = retryHints ? `\n\n上一次生成存在以下问题，务必修正：\n${retryHints}` : ''
  return `为课题「${topicName}」生成知识点学习图谱。
${researchBlock}

要求：
1. 知识点数量 15~40 个，覆盖该课题从入门到进阶的主干内容
2. 每个知识点给出前置依赖（deps），构成有向无环图（DAG），严禁出现环
3. 依赖关系要体现学习顺序：入门节点 deps 为空，进阶节点依赖其前置知识
4. id 用 snake_case 英文短标识（如 logistic_regression），name 用中文，description 一句话说明该知识点学什么
5. 粒度适中：一个知识点对应约 15 分钟微课可讲完的内容

输出 JSON 格式：
{"nodes": [{"id": "xxx", "name": "中文名", "description": "一句话描述", "deps": ["前置id"]}]}${hints}`
}
