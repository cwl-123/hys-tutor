import type { KnowledgeNode, ResearchNote } from '../../../shared/types'
import type { LlmOutline } from './outline'

export const WRITE_SYSTEM_PROMPT = `你是一位优秀的技术讲师，擅长把复杂概念讲得循序渐进、贴近听众。
你直接输出课程 markdown 正文，不输出任何前后缀说明。`

export const REVISE_SYSTEM_PROMPT = `你是一位严格的课程修订编辑。你会收到已生成的课程正文、研究笔记和用户的修改意见，输出修订后的完整课程 markdown。
修订原则：忠于研究笔记的事实与来源引用；保留原课程中正确的部分；针对用户意见做实质调整而非表面改写；保留原文中恰当的 Mermaid 图表与图片引用（\`![图注](路径)\`，路径原样保留，不要改写或新造图片 URL）；不要添加「参考来源 / 参考文献」小节（页面会自动列出来源清单）。
你直接输出修订后的完整 markdown，不输出任何前后缀说明。`

export function reviseLessonPrompt(opts: {
  contentMd: string
  instruction: string
  noteJson: string
  sources: string
}): string {
  return `请根据用户意见修订以下课程。

用户意见：
${opts.instruction.trim() || '（未填写具体意见：请自行检查并改进讲解清晰度、例子贴合度与篇幅节奏）'}

研究笔记（事实依据）：
${opts.noteJson}

来源列表（正文中用 [1] [2] 形式引用）：
${opts.sources}

原课程正文：
<<<CONTENT
${opts.contentMd}
CONTENT>>>

输出修订后的完整课程 markdown（保持 15 分钟微课篇幅与原有章节结构风格）。`
}

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
7. 语言：中文，讲人话，避免堆砌术语
8. 图示（重要，文字讲不清的就画图）：抽象结构、流程、对比、决策路径等用 Mermaid 围栏图表达（\`\`\`mermaid，flowchart/sequence/er/class 等类型），每课 1~3 张，节点文字简洁；放在最需要看图的讲解段落之后
9. 配图：研究笔记 images 里若有贴切的图，挑 0~2 张用 \`![一句话图注](localPath)\` 嵌入（优先 localPath 字段；图注说明"这张图帮读者看懂什么"）；没有贴切的就不放，严禁编造图片 URL
10. 不要写「参考来源 / 参考文献 / 参考资料」小节，正文只需用 [n] 就地标注引用——页面会自动统一列出来源清单，正文再写一遍会重复`
}
