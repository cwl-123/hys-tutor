import { z } from 'zod'

// 偏好提取：从用户交互话语中提炼可跨课复用的长期讲法偏好
export const llmPreferenceOpsSchema = z.object({
  ops: z
    .array(
      z.object({
        action: z.enum(['add', 'merge']).describe('add=新增偏好；merge=与现有偏好同义，合并进该条'),
        targetId: z.string().optional().describe('merge 时必填：要合并进的现有偏好 id'),
        text: z.string().min(1).max(100).describe('偏好正文：一句直白的中文短句'),
      }),
    )
    .max(3),
})
export type LlmPreferenceOps = z.infer<typeof llmPreferenceOpsSchema>

export const PREFERENCE_EXTRACT_SYSTEM_PROMPT = `你负责维护学习者的「长期偏好档案」。从用户的一句话中判断：里面是否包含可跨课程复用的长期讲法/学习偏好（如讲解深浅、举例偏好、风格节奏、数学公式接受度）。
你只输出合法 JSON，不输出任何解释。字符串值内部如需引用词句，一律用中文引号「」，严禁出现未转义的英文双引号。`

export function preferenceExtractPrompt(opts: {
  interaction: string
  existing: { id: string; text: string }[]
}): string {
  const existing = opts.existing.length
    ? opts.existing.map((p) => `- [${p.id}] ${p.text}`).join('\n')
    : '（空）'
  const full = opts.existing.length >= 50
    ? '\n注意：偏好清单已满 50 条，不允许 add，只能 merge 进已有条目或输出空 ops。'
    : ''
  return `用户刚说了一句话（来自课件对话/优化意见/报错备注）：
「${opts.interaction}」

现有偏好清单：
${existing}
${full}
判断规则：
1. 只提炼「可跨课程复用的长期偏好」（如「讲新概念先举生活例子再上公式」「少堆数学推导，多给工程直觉」）
2. 只针对当前内容的当次意见（如「这一节写错了」「这段删掉」「这里加个例子」）不算偏好，ops 输出空数组
3. 与现有清单某条同义 → action=merge，targetId 填该条 id，text 为合并后的更准表述；全新偏好 → action=add
4. text 必须是一句直白的中文短句（≤40 字），站在学习者角度、可直接照做的讲法要求
5. 没有可提炼的偏好就输出空 ops，宁可不记也不要硬凑

输出 JSON：{"ops": [{"action": "add", "text": "..."}]} 或 {"ops": [{"action": "merge", "targetId": "...", "text": "..."}]} 或 {"ops": []}`
}
