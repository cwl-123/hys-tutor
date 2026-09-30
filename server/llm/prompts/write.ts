import type { KnowledgeNode, ResearchNote } from '../../../shared/types'
import type { LlmOutline } from './outline'

export const WRITE_SYSTEM_PROMPT = `你是一位优秀的技术讲师，擅长把复杂概念讲得循序渐进、贴近听众。
你直接输出课程 markdown 正文，不输出任何前后缀说明。`

export function writeLessonPrompt(opts: {
  topicName: string
  node: KnowledgeNode
  outline: LlmOutline
  note: ResearchNote
  learnerCtx: string
}): string {
  const sources = opts.note.sources
    .map((s, i) => `[${i + 1}] ${s.title} ${s.url}`)
    .join('\n')
  const sections = opts.outline.sections
    .map((s, i) => `${i + 1}. ${s.title}\n   - ${s.points.join('\n   - ')}${s.citations.length ? `\n   - 引用来源：${s.citations.map((c) => `[${c}]`).join('')}` : ''}`)
    .join('\n')
  return `写一节 15 分钟微课（markdown）。

课题：「${opts.topicName}」
本课知识点：${opts.node.name} —— ${opts.node.description}

大纲：
${sections}

教学重点：${opts.outline.focus}
教学提示：${opts.outline.teachingNotes}

研究笔记（写作素材，内容以它为准，不要编造）：
${JSON.stringify(opts.note, null, 2)}

来源列表（正文中用 [1] [2] 形式引用）：
${sources}

${opts.learnerCtx}

写作要求：
1. 篇幅 2500~3500 字，按大纲组织章节（## 二级标题）
2. 公式用 KaTeX：行内 $...$，独立公式 $$...$$
3. 关键事实性结论标注来源引用 [n]
4. 代码示例用围栏代码块并标语言
5. 开头用 2~3 句话结合学习者当前状态引入（参考掌握度快照和错题摘要），让学习者明白"为什么现在学这个"
6. 结尾加"本课小结"和"下一课预告"（依据掌握度快照推测）
7. 语言：中文，讲人话，避免堆砌术语`
}
