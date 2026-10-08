import { z } from 'zod'
import type { LessonQuote } from '../../../shared/lesson-chat'

// 第一步：只做「分类 + 简短回复」，不含长正文，保证 JSON 输出可靠
export const llmLessonPlanSchema = z.object({
  reply: z
    .string()
    .describe('给学习者的自然语言回复：说明你打算怎么改、为什么；纯咨询则直接作答'),
  scope: z
    .enum(['none', 'section', 'full'])
    .default('none')
    .describe('none=无需改课件；section=只改某一节；full=整篇重写'),
  targetHeading: z
    .string()
    .optional()
    .describe('scope=section 时要替换的章节标题原文，必须来自目标章节清单'),
  summary: z.string().optional().describe('一句话概括将要做的改动'),
})
export type LlmLessonPlan = z.infer<typeof llmLessonPlanSchema>

export const LESSON_PLAN_SYSTEM_PROMPT = `你是课程修订助手，帮学习者按需优化一节已生成的微课课件。你会收到完整课程正文、研究笔记（事实依据）、来源列表、可选的目标章节清单、用户诉求（可能附带引用片段）与少量对话历史。

你只判断"要不要改、改哪里"，并给出简短回复，不输出正文。输出 JSON：
- scope=none：用户只是提问或咨询，不需要改课件；reply 直接作答。
- scope=section：诉求只涉及某一节（如"这节讲得太深""这段例子换一个""补个推导"）→ targetHeading 必须取自目标章节清单标题原文；summary 一句话概括。
- scope=full：诉求涉及整篇（如"整体太难/太长""我基础很差，全部重写成更通俗的""增加一个章节""换教学风格"）→ summary 一句话概括。

规则：
1. reply 用中文简短说明你的处理思路，不要长篇大论，不要输出 markdown 正文。
2. 拿不准是否要改时，若用户明显是在提修改诉求就选 section 或 full；纯问答选 none。
3. 只输出合法 JSON：{"reply":"...","scope":"none|section|full","targetHeading":"...","summary":"..."}，字符串内不要出现未转义的英文双引号（引用词句用「」）。`

export function lessonPlanUserPrompt(opts: {
  topicName: string
  nodeName: string
  contentMd: string
  headings: string[]
  noteJson: string
  sources: string
  quote?: LessonQuote
  message: string
  history: { role: 'user' | 'assistant'; content: string }[]
}): string {
  const historyBlock = opts.history.length
    ? `\n对话历史（仅供理解上下文）：\n${opts.history
        .map((h) => `${h.role === 'user' ? '用户' : '助手'}：${h.content.slice(0, 400)}`)
        .join('\n')}\n`
    : ''

  const quoteBlock = opts.quote
    ? `\n用户引用：${opts.quote.heading ? `章节「${opts.quote.heading}」` : ''}${
        opts.quote.text ? `\n> ${opts.quote.text.slice(0, 1500)}` : ''
      }\n`
    : ''

  const headingList = opts.headings.length ? opts.headings.map((h) => `- ${h}`).join('\n') : '（无二级标题）'

  return `课题：「${opts.topicName}」 本课知识点：${opts.nodeName}

当前课程正文：
<<<CONTENT
${opts.contentMd}
CONTENT>>>

目标章节清单（scope=section 的 targetHeading 必须取自这里）：
${headingList}

研究笔记（事实依据）：
${opts.noteJson}

来源列表（正文中用 [1] [2] 形式引用）：
${opts.sources}
${historyBlock}${quoteBlock}
用户诉求：${opts.message}`
}

// 第二步（scope=section）：只输出这一节修订后的 markdown
export const LESSON_SECTION_EDIT_SYSTEM_PROMPT = `你是严格的课程修订编辑。只输出"修订后的这一节"的 markdown 正文，不要输出任何前后缀说明，也不要用代码围栏包裹整节。
要求：以给定的 ## 标题行开头；只包含这一节的内容；忠于研究笔记的事实，保留正文中的来源引用 [n] 标记；针对用户诉求做实质调整。`

export function lessonSectionEditPrompt(opts: {
  topicName: string
  nodeName: string
  contentMd: string
  targetHeading: string
  noteJson: string
  sources: string
  quote?: LessonQuote
  message: string
}): string {
  const quoteBlock = opts.quote?.text ? `\n用户引用的具体段落：\n> ${opts.quote.text.slice(0, 1500)}\n` : ''
  return `课题：「${opts.topicName}」 本课知识点：${opts.nodeName}

当前完整课程正文（只改其中一节，其余不要输出）：
<<<CONTENT
${opts.contentMd}
CONTENT>>>

要修订的章节标题：${opts.targetHeading}

研究笔记（事实依据）：
${opts.noteJson}

来源列表（正文中用 [1] [2] 形式引用）：
${opts.sources}
${quoteBlock}
用户诉求：${opts.message}

请只输出该章节修订后的 markdown（以「## ${opts.targetHeading}」开头），不要输出其他章节。`
}

// 第二步（scope=full）：输出整篇修订后的 markdown
export const LESSON_REWRITE_SYSTEM_PROMPT = `你是严格的课程修订编辑。只输出修订后的完整课程 markdown，不要输出任何前后缀说明。
要求：忠于研究笔记的事实，保留来源引用 [n] 标记；保留原课程中正确的部分，针对诉求做实质调整；保持 15 分钟微课的篇幅与章节结构。`

export function lessonRewritePrompt(opts: {
  topicName: string
  nodeName: string
  contentMd: string
  noteJson: string
  sources: string
  message: string
}): string {
  return `课题：「${opts.topicName}」 本课知识点：${opts.nodeName}

研究笔记（事实依据）：
${opts.noteJson}

来源列表（正文中用 [1] [2] 形式引用）：
${opts.sources}

原课程正文：
<<<CONTENT
${opts.contentMd}
CONTENT>>>

用户诉求：${opts.message}

请输出修订后的完整课程 markdown。`
}