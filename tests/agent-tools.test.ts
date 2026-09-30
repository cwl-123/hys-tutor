import { describe, expect, it } from 'vitest'
import { mergeSearchResults, normalizeUrl, type SearchResult } from '../server/agent/tools/web-search'
import { extractMainContent } from '../server/agent/tools/web-fetch'
import { mergeResearchNotes, type NotePatch } from '../server/agent/tools/notes'
import type { ResearchNote } from '../shared/types'

function sr(url: string, provider: SearchResult['provider'] = 'tavily', title = url): SearchResult {
  return { title, url, snippet: '', provider }
}

describe('web-search 合并去重', () => {
  it('按归一化 URL 去重，先传入的路优先', () => {
    const merged = mergeSearchResults(
      [sr('https://a.com/x/', 'tavily', 'A路'), sr('https://b.com/y', 'tavily')],
      [sr('https://a.com/x?utm_source=t', 'bocha', 'B路'), sr('https://c.com/z', 'bocha')],
    )
    expect(merged.map((r) => r.url)).toEqual(['https://a.com/x/', 'https://b.com/y', 'https://c.com/z'])
    expect(merged[0].title).toBe('A路')
  })

  it('normalizeUrl 去 hash/utm/尾斜杠', () => {
    expect(normalizeUrl('https://a.com/p/#sec')).toBe('https://a.com/p')
    expect(normalizeUrl('https://a.com/p/?utm_medium=x&id=1')).toBe('https://a.com/p/?id=1')
    expect(normalizeUrl('https://a.com/x/')).toBe(normalizeUrl('https://a.com/x'))
    expect(normalizeUrl('not-a-url')).toBe('not-a-url')
  })
})

describe('web-fetch 正文提取', () => {
  it('readability 提取文章正文', () => {
    const html = `<html><head><title>页面标题</title></head><body>
      <nav>导航 导航 导航</nav>
      <article>
        <h1>FM 原理</h1>
        <p>${'因子分解机通过隐向量内积建模特征交叉。'.repeat(10)}</p>
        <p>${'相比多项式回归，参数量从 O(n^2) 降到 O(nk)。'.repeat(10)}</p>
      </article>
      <footer>版权信息</footer>
    </body></html>`
    const { title, text } = extractMainContent(html, 'https://example.com/fm')
    expect(title).toBeTruthy()
    expect(text).toContain('隐向量内积')
    expect(text).not.toContain('版权信息')
  })
})

describe('研究笔记合并', () => {
  const patch: NotePatch = {
    concepts: ['FM 用隐向量内积建模二阶交叉'],
    derivations: ['y = w0 + Σwixi + ΣΣ<vi,vj>xixj'],
    examples: ['广告 CTR 场景的稀疏特征交叉'],
    pitfalls: ['与 FFM 混淆：FM 每个特征只有一个隐向量'],
    sources: [{ title: 'FM 论文解读', url: 'https://a.com/fm' }],
  }

  it('无旧笔记时创建 version 1，记录搜索词', () => {
    const note = mergeResearchNotes(null, patch, 'n_fm', ['FM 原理', 'FM 原理'])
    expect(note.version).toBe(1)
    expect(note.nodeId).toBe('n_fm')
    expect(note.searchQueries).toEqual(['FM 原理'])
    expect(note.sources[0].fetchedAt).toBeTruthy()
  })

  it('合并时并集去重、version 递增', () => {
    const base: ResearchNote = {
      id: 'rn_1',
      nodeId: 'n_fm',
      concepts: ['FM 用隐向量内积建模二阶交叉', 'FM 是线性模型推广'],
      derivations: [],
      examples: [],
      pitfalls: [],
      sources: [{ title: '旧来源', url: 'https://a.com/fm', fetchedAt: 'x' }],
      searchQueries: ['FM 原理'],
      version: 1,
      updatedAt: 'x',
    }
    const merged = mergeResearchNotes(base, patch, 'n_fm', ['FM 误区'])
    expect(merged.id).toBe('rn_1')
    expect(merged.version).toBe(2)
    expect(merged.concepts).toHaveLength(2) // 重复项不再加入
    expect(merged.sources).toHaveLength(1) // 同 URL 去重
    expect(merged.searchQueries).toEqual(['FM 原理', 'FM 误区'])
  })
})
