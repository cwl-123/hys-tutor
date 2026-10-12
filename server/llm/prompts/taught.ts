import { z } from 'zod'

export const llmTaughtSchema = z.object({
  examples: z
    .array(z.string())
    .max(6)
    .default([])
    .describe('本课实际用到的具体案例/例子/类比/数据，每条一句话，最多 6 条，没有则空数组'),
})
export type LlmTaught = z.infer<typeof llmTaughtSchema>

export const TAUGHT_SYSTEM_PROMPT = `你是一位课程归档助手。请从一节已经写好的课程正文中，提炼出「本课实际用到的具体案例、例子、类比、数据」。
用途：后续同方向的其他课程要避免重复使用同样的例子，所以只需记录具体元素，不要泛泛概括，不要记录知识点名称或概念定义本身。
只输出合法 JSON，不输出任何解释。`

export function taughtExtractPrompt(nodeName: string, contentMd: string): string {
  return `本课知识点：${nodeName}

课程正文：
<<<CONTENT
${contentMd}
CONTENT>>>

请提炼本课用到的具体案例/例子/类比/数据（每条一句话，最多 6 条；没有具体案例则返回空数组）。输出 JSON：{"examples": ["..."]}`
}