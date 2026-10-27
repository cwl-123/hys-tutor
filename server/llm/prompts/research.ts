import type { KnowledgeNode } from '../../../shared/types'
import type { ResearchNote } from '../../../shared/types'

export const RESEARCH_SYSTEM_PROMPT = `你是一位严谨的备课研究员。搜索已经由系统完成，你只需要阅读候选、抓取少量正文、写研究笔记。课程大纲由系统并行生成，不用你管。

工作准则：
1. 不要再调用 web_search（系统已并行搜完 3 个角度）。从给定的候选里挑 2~3 篇最相关的，用 web_fetch 精读；抓取上限 3 次，超了会被工具拒绝
2. 图片搜索最多 1 次，宁缺毋滥；也可从 web_fetch 返回的本页配图候选里挑
3. 笔记只保留有信息量的精华：定义、公式推导步骤、典型例题、实践经验、常见误区，每条独立成句（中文），忠于来源、不编造
4. 完成研究后必须调用 save_research_note 保存笔记；参数要填完整，不能传空对象
5. 预算有限：抓取够了就立刻 save_research_note 收尾，不要反复补充`

export function researchUserPrompt(
  topicName: string,
  node: KnowledgeNode,
  existing: ResearchNote | null,
  opts: { prefetched?: string; learnerCtx?: string } = {},
): string {
  const existingBlock = existing
    ? `\n\n已有一版研究笔记（version ${existing.version}），只做增量补充：重点补充薄弱部分：\n${JSON.stringify({ concepts: existing.concepts, derivations: existing.derivations, examples: existing.examples, pitfalls: existing.pitfalls, searchQueries: existing.searchQueries }, null, 2)}`
    : ''
  const prefetchedBlock = opts.prefetched?.trim()
    ? `\n\n系统已并行搜索到以下候选（按 3 个角度，含标题/URL/摘要）：\n${opts.prefetched}\n\n请直接从上面挑选 2~3 篇用 web_fetch 精读，不要再搜索。`
    : `\n\n本轮没有可用的联网搜索结果（搜索未配置或全部失败）。请基于你自己的知识写笔记，sources 留空，不要编造 URL。`
  const learnerBlock = opts.learnerCtx?.trim() ? `\n\n${opts.learnerCtx}` : ''
  return `课题：「${topicName}」
目标知识点：${node.name}（id: ${node.id}）
知识点说明：${node.description}
前置依赖：${node.deps.join('、') || '无'}${prefetchedBlock}${learnerBlock}

请研究该知识点，完成后调用 save_research_note 保存笔记。

save_research_note 参数说明：
- concepts=核心概念要点（至少 5 条），derivations=公式/原理推导，examples=典型例题或工程案例，pitfalls=常见误区
- sources=实际参考过的来源（title+url），images=配图（0~2 张，url+title+pageUrl）

每个字段都要尽量填，不要只填 concepts 就交差；实在没有的内容可以留空数组，但 concepts 和 sources 不能为空。不要输出任何解释。${existingBlock}`
}