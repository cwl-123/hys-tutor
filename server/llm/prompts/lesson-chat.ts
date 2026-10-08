import { z } from 'zod'
import type { LessonQuote } from '../../../shared/lesson-chat'

export const llmLessonEditSchema = z.object({
  reply: z
    .string()
    .describe('给学习者的自然语言回复：说明你改了什么、为什么这样改；纯咨询则直接作答'),
  action: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('none') }),
      z.object({
        type: z.literal('edit_section'),
        targetHeading: z.string().describe('要替换的章节标题原文，必须是课程中已存在的 ## 标题'),
        revisedMd: z.string().describe('该章节修订后的完整 markdown（含 ## 标题行），只包含这一节'),
        summary: z.string().describe('一句话概括本节改动'),
      }),
      z.object({
        type: z.literal('rewrite_all'),
        revisedMd: z.string().describe('修订后的完整课程 markdown'),
        summary: z.string().describe('一句话概括整篇改动'),
      }),
    ])
    .optional()
    .describe('修改动作；纯咨询或无需改课件时省略'),
})
export type LlmLessonEdit = z.infer<typeof llmLessonEditSchema>

export const LESSON_CHAT_SYSTEM_PROMPT = `你是课程修订助手，帮学习者按需优化一节已生成的微课课件。你会收到完整课程 markdown、研究笔记（事实依据）、来源列表、可选的目标章节标题清单、用户诉求（可能附带引用片段）与少量对话历史。

判断并输出动作 action：
- edit_section：诉求只涉及某个章节（如"这节讲得太深""这段例子换一个""补个推导"）→ targetHeading 必须是目标章节清单中的标题原文；revisedMd 输出"该章节修订后的完整 markdown"，必须以该 ## 标题行开头、只包含这一节（不要带其他章节）。
- rewrite_all：诉求涉及整篇（如"整体太难/太长""我的基础很差，全部重写成更通俗的""增加一个章节""换教学风格"）→ revisedMd 输出修订后的完整课程 markdown。
- none：用户只是提问或咨询，不需要改课件 → 只回复 reply。

规则：
1. 事实以研究笔记为准，不得编造；保留正文中的来源引用 [n] 标记。
2. 忠于原课程中正确的部分，针对诉求做实质调整，不要只做同义改写。
3. 局部修改不得改动其他章节；译文长度与作用域匹配（15 分钟微课节奏）。
4. 面向"看不懂"的诉求：多用类比、拆小步骤、补前序概念，降低门槛但不牺牲准确性。
5. reply 用中文简短说明你的处理（改了什么 / 为什么不改）。
6. revisedMd 内部不要出现未转义的英文双引号（引用词句用「」）。
只输出合法 JSON：{"reply":"...","action":{...}}`

export function lessonChatUserPrompt(opts: {
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

  const headingList = opts.headings.length
    ? opts.headings.map((h) => `- ${h}`).join('\n')
    : '（无二级标题）'

  return `课题：「${opts.topicName}」 本课知识点：${opts.nodeName}

当前课程正文：
<<<CONTENT
${opts.contentMd}
CONTENT>>>

当前课程的目标章节清单（edit_section 的 targetHeading 必须取自这里）：
${headingList}

研究笔记（事实依据）：
${opts.noteJson}

来源列表（正文中用 [1] [2] 形式引用）：
${opts.sources}
${historyBlock}${quoteBlock}
用户诉求：${opts.message}`
}