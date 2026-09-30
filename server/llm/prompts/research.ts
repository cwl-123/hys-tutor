import type { KnowledgeNode } from '../../../shared/types'
import type { ResearchNote } from '../../../shared/types'

export const RESEARCH_SYSTEM_PROMPT = `你是一位严谨的备课研究员。你的任务是通过工具搜索和阅读网上的优质内容，为一个知识点提炼研究笔记。

工作准则：
1. 从不同角度搜索 2~4 次（如：原理与公式推导、工程实践/案例、常见误区/易混淆点），中英文关键词都可以
2. 从搜索结果中挑 1~3 篇最相关的抓取正文精读，不要每篇都抓
3. 只保留有信息量的精华：定义、公式推导步骤、典型例题、实践经验、常见误区，每条独立成句（中文）
4. 忠于来源，不编造；每条内容尽量能对应到某个来源
5. 完成研究后必须调用 save_research_note 保存笔记，然后简短收尾`

export function researchUserPrompt(topicName: string, node: KnowledgeNode, existing: ResearchNote | null): string {
  const existingBlock = existing
    ? `\n\n已有一版研究笔记（version ${existing.version}），只做增量补充：搜索时避开已搜过的 query，重点补充薄弱部分：\n${JSON.stringify({ concepts: existing.concepts, derivations: existing.derivations, examples: existing.examples, pitfalls: existing.pitfalls, searchQueries: existing.searchQueries }, null, 2)}`
    : ''
  return `课题：「${topicName}」
目标知识点：${node.name}（id: ${node.id}）
知识点说明：${node.description}
前置依赖：${node.deps.join('、') || '无'}

请研究该知识点并保存研究笔记。save_research_note 的参数中：concepts=核心概念要点，derivations=公式/原理推导，examples=典型例题或工程案例，pitfalls=常见误区，sources=实际参考过的来源（title+url）。${existingBlock}`
}
