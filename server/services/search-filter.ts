import { completeJson } from '../llm/client'
import { llmFilterSchema, SEARCH_FILTER_SYSTEM_PROMPT, searchFilterPrompt } from '../llm/prompts/filter'
import type { SearchResult } from '../agent/tools/web-search'

export interface FilterDrop {
  title: string
  url: string
  reason: string
}

export interface FilterOutcome {
  kept: SearchResult[]
  drops: FilterDrop[]
  judgeApplied: boolean
}

// 规则预筛（保底线）：丢掉加载不出任何信息的空壳条目（无 URL / 标题与摘要都为空）
export function rulePrefilter(results: SearchResult[]): SearchResult[] {
  return results.filter((r) => r.url.trim() && !(r.title.trim().length < 2 && r.snippet.trim().length < 2))
}

// 相关性过滤：规则预筛 + 一次批量 LLM 判定，只剔除明显无用项，宁滥毋缺。
// 任何异常（判定失败/全部被剔）都回退到预筛结果，绝不让研究因过滤而没东西可读。
export async function filterSearchResults(opts: {
  query: string
  nodeName: string
  nodeDescription?: string
  results: SearchResult[]
}): Promise<FilterOutcome> {
  const candidates = rulePrefilter(opts.results)
  if (candidates.length <= 2) return { kept: candidates, drops: [], judgeApplied: false }

  try {
    const out = await completeJson({
      system: SEARCH_FILTER_SYSTEM_PROMPT,
      prompt: searchFilterPrompt({ ...opts, candidates }),
      schema: llmFilterSchema,
      temperature: 0.1,
    })
    const reasonByIndex = new Map(out.drops.map((d) => [d.i, d.reason]))
    const drops: FilterDrop[] = []
    const kept = candidates.filter((r, idx) => {
      const reason = reasonByIndex.get(idx + 1)
      if (reason === undefined) return true
      drops.push({ title: r.title, url: r.url, reason })
      return false
    })
    if (kept.length === 0) return { kept: candidates, drops: [], judgeApplied: false }
    return { kept, drops, judgeApplied: true }
  } catch {
    return { kept: candidates, drops: [], judgeApplied: false }
  }
}