import { z } from 'zod'
import type { KnowledgeNode, ResearchNote } from '../../../shared/types'

export const llmOutlineSchema = z.object({
  focus: z.string().describe('本课教学重点，一句话'),
  sections: z
    .array(
      z.object({
        title: z.string(),
        points: z.array(z.string()),
        citations: z.array(z.number()).default([]),
      }),
    )
    .min(3),
  teachingNotes: z.string().default('').describe('针对该学习者的教学提示（深浅、举例方向）'),
})
export type LlmOutline = z.infer<typeof llmOutlineSchema>

export const OUTLINE_SYSTEM_PROMPT = `你是一位自适应课程设计师。基于研究笔记和学习者当前状态，为一节 15 分钟微课设计大纲。
你只输出合法 JSON，不输出任何解释。字符串值内部如需引用词句，一律用中文引号「」，严禁出现未转义的英文双引号。`

export function learnerContextText(ctx: {
  masterySnapshot: Record<string, number>
  wrongAnswers: string[]
  reports: { quote: string; note?: string }[]
  nodeNames: Record<string, string>
  profileText?: string
}): string {
  const snapshot = Object.entries(ctx.masterySnapshot)
    .map(([id, m]) => `${ctx.nodeNames[id] ?? id}=${m}`)
    .join('、')
  const wrong = ctx.wrongAnswers.length ? ctx.wrongAnswers.join('\n') : '（暂无错题记录）'
  const reports = ctx.reports.length
    ? ctx.reports.map((r) => `- 「${r.quote.slice(0, 80)}」${r.note ? `（用户备注：${r.note}）` : ''}`).join('\n')
    : '（暂无报错记录）'
  const profile = ctx.profileText ? `\n\n${ctx.profileText}` : ''
  return `学习者掌握度快照：${snapshot}

历史错题摘要：
${wrong}

用户标记的内容报错（务必避坑，不要重复同样的错误讲法）：
${reports}${profile}`
}

export function outlineUserPrompt(
  node: KnowledgeNode,
  note: ResearchNote,
  learnerCtx: string,
): string {
  return `为本课设计大纲。

目标知识点：${node.name}
知识点说明：${node.description}

研究笔记（citations 中的数字对应 sources 数组下标+1）：
${JSON.stringify(note, null, 2)}

${learnerCtx}

要求：
1. 4~6 个 section，符合 15 分钟微课容量：引入（结合学习者情况）→ 核心讲解 → 例题/案例 → 小结
2. 依据学习者掌握度决定深浅：已掌握的相关点略讲，薄弱点展开讲
3. 每个 section 的 points 是要讲的具体内容点，citations 标注依据的来源编号
4. teachingNotes 写给"写课的老师"：提醒哪里要照顾学习者的薄弱点、哪里要避开历史报错

输出 JSON：{"focus": "...", "sections": [{"title": "...", "points": ["..."], "citations": [1]}], "teachingNotes": "..."}`
}
