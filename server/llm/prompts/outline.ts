import { z } from 'zod'
import type { KnowledgeNode, ResearchNote } from '../../../shared/types'

export const llmOutlineSchema = z.object({
  focus: z.string().describe('本课教学重点，一句话'),
  objectives: z
    .array(z.string())
    .min(2)
    .max(4)
    .describe('本课学习目标：2~4 条，动词开头、可检验（如「能推导出交叉熵损失的梯度形式」），课程与出题都围绕它'),
  difficulty: z.enum(['入门', '进阶', '高级']).describe('本课难度档位，由学习者当前掌握度决定'),
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
  preferenceText?: string
  taughtText?: string
}): string {
  const snapshot = Object.entries(ctx.masterySnapshot)
    .map(([id, m]) => `${ctx.nodeNames[id] ?? id}=${m}`)
    .join('、')
  const wrong = ctx.wrongAnswers.length ? ctx.wrongAnswers.join('\n') : '（暂无错题记录）'
  const reports = ctx.reports.length
    ? ctx.reports.map((r) => `- 「${r.quote.slice(0, 80)}」${r.note ? `（用户备注：${r.note}）` : ''}`).join('\n')
    : '（暂无报错记录）'
  const profile = ctx.profileText ? `\n\n${ctx.profileText}` : ''
  const preferences = ctx.preferenceText ? `\n\n${ctx.preferenceText}` : ''
  const taught = ctx.taughtText ? `\n\n${ctx.taughtText}` : ''
  return `学习者掌握度快照：${snapshot}

历史错题摘要：
${wrong}

用户标记的内容报错（务必避坑，不要重复同样的错误讲法）：
${reports}${taught}${profile}${preferences}`
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
5. objectives 是本课的学习目标，2~4 条，动词开头、可检验（学完这节课能做什么），后续正文与出题都围绕它
6. difficulty 依据学习者掌握度与知识点本身给出：基础概念/低掌握分→入门，需推导理解→进阶，综合难点→高级
7. 已讲过的内容（如有）避免重复：换新例子/新角度，不要照搬旧案例

输出 JSON：{"focus": "...", "objectives": ["能...", "会..."], "difficulty": "进阶", "sections": [{"title": "...", "points": ["..."], "citations": [1]}], "teachingNotes": "..."}`
}
