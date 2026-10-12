import { describe, expect, it, vi } from 'vitest'
import type { SearchResult } from '../server/agent/tools/web-search'

const completeJson = vi.fn()
vi.mock('../server/llm/client', () => ({
  completeJson: (...args: unknown[]) => completeJson(...args),
}))

const { filterSearchResults, rulePrefilter } = await import('../server/services/search-filter')

function sr(title: string, url: string, snippet = '有内容的摘要文本'): SearchResult {
  return { title, url, snippet, provider: 'bocha' }
}

describe('rulePrefilter', () => {
  it('保留有 URL 的正常结果', () => {
    const results = [sr('A', 'https://a.com'), sr('B', 'https://b.com')]
    expect(rulePrefilter(results)).toHaveLength(2)
  })

  it('丢弃无 URL 的条目', () => {
    expect(rulePrefilter([sr('A', '   ')])).toHaveLength(0)
  })

  it('丢弃标题与摘要都为空壳的条目', () => {
    expect(rulePrefilter([sr('', 'https://a.com', '')])).toHaveLength(0)
  })
})

describe('filterSearchResults', () => {
  it('候选≤2 时不做 LLM 判定，直接返回预筛结果', async () => {
    completeJson.mockReset()
    const out = await filterSearchResults({
      query: 'q',
      nodeName: 'n',
      results: [sr('A', 'https://a.com')],
    })
    expect(out.judgeApplied).toBe(false)
    expect(out.kept).toHaveLength(1)
    expect(completeJson).not.toHaveBeenCalled()
  })

  it('按 LLM 判定只剔除被点名的条目', async () => {
    completeJson.mockReset()
    completeJson.mockResolvedValue({ drops: [{ i: 2, reason: '串台' }] })
    const results = [sr('A', 'https://a.com'), sr('B', 'https://b.com'), sr('C', 'https://c.com')]
    const out = await filterSearchResults({ query: 'q', nodeName: 'n', results })
    expect(out.judgeApplied).toBe(true)
    expect(out.kept.map((r) => r.url)).toEqual(['https://a.com', 'https://c.com'])
    expect(out.drops).toEqual([{ title: 'B', url: 'https://b.com', reason: '串台' }])
  })

  it('判定想清空全部时回退到预筛结果（宁滥毋缺）', async () => {
    completeJson.mockReset()
    completeJson.mockResolvedValue({ drops: [{ i: 1, reason: 'x' }, { i: 2, reason: 'x' }, { i: 3, reason: 'x' }] })
    const results = [sr('A', 'https://a.com'), sr('B', 'https://b.com'), sr('C', 'https://c.com')]
    const out = await filterSearchResults({ query: 'q', nodeName: 'n', results })
    expect(out.judgeApplied).toBe(false)
    expect(out.kept).toHaveLength(3)
  })

  it('判定调用异常时回退到预筛结果', async () => {
    completeJson.mockReset()
    completeJson.mockRejectedValue(new Error('LLM 挂了'))
    const results = [sr('A', 'https://a.com'), sr('B', 'https://b.com'), sr('C', 'https://c.com')]
    const out = await filterSearchResults({ query: 'q', nodeName: 'n', results })
    expect(out.judgeApplied).toBe(false)
    expect(out.kept).toHaveLength(3)
  })
})