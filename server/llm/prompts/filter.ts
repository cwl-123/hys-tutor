import { z } from 'zod'
import type { SearchResult } from '../../agent/tools/web-search'

export const llmFilterSchema = z.object({
  drops: z
    .array(
      z.object({
        i: z.number().describe('需要剔除的候选序号，从 1 开始'),
        reason: z.string().default('').describe('剔除原因，一句话'),
      }),
    )
    .default([]),
})
export type LlmFilter = z.infer<typeof llmFilterSchema>

export const SEARCH_FILTER_SYSTEM_PROMPT = `你是一位检索结果的筛选助手。用户为研究某个知识点做了一次联网搜索，你要从候选结果里挑出「明显没用」的剔除，其余一律保留。
判断准则：
1. 只剔除明显无用的：与本知识点无关的串台结果（例如搜索词被歧义理解）、纯导航/广告/付费墙空壳页、完全没有正文的聚合列表页
2. 只要结果有可能对讲解该知识点有帮助，就保留——通俗易懂的教程、博客、问答同样优秀，不要因为来源不够权威或不够专业而剔除
3. 宁滥毋缺：拿不准的一律保留，宁可多留几条
4. 只做「相关性与可用性」的底线判断，不做内容质量打分
你只输出合法 JSON，不输出任何解释。`

export function searchFilterPrompt(opts: {
  query: string
  nodeName: string
  nodeDescription?: string
  candidates: SearchResult[]
}): string {
  const list = opts.candidates
    .map(
      (r, i) =>
        `${i + 1}. (${r.provider}) ${r.title}\n   URL: ${r.url}\n   摘要: ${r.snippet.replace(/\s+/g, ' ').slice(0, 200)}`,
    )
    .join('\n')
  return `目标知识点：${opts.nodeName}${opts.nodeDescription ? ` —— ${opts.nodeDescription}` : ''}
本次搜索词：${opts.query}
搜索平台偏好（参考，不强制）：权威文档/百科/大学课件/GitHub 与 通俗博客/问答 都欢迎，按相关性判断即可。

候选结果：
${list}

请只列出需要剔除的结果，其余默认保留。输出 JSON：{"drops":[{"i":1,"reason":"..."}]}；若没有需要剔除的，drops 为空数组。`
}