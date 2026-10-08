import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { mergeSearchResults, normalizeUrl, type SearchResult } from '../server/agent/tools/web-search'
import { extractMainContent, extractPageImages } from '../server/agent/tools/web-fetch'
import { searchImages } from '../server/agent/tools/image-search'
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
    images: [{ url: 'https://img.com/fm.png', title: 'FM 结构图', pageUrl: 'https://a.com/fm' }],
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
      images: [{ url: 'https://img.com/old.png' }],
      searchQueries: ['FM 原理'],
      version: 1,
      updatedAt: 'x',
    }
    const merged = mergeResearchNotes(base, patch, 'n_fm', ['FM 误区'])
    expect(merged.id).toBe('rn_1')
    expect(merged.version).toBe(2)
    expect(merged.concepts).toHaveLength(2) // 重复项不再加入
    expect(merged.sources).toHaveLength(1) // 同 URL 去重
    expect(merged.images).toEqual([
      { url: 'https://img.com/old.png' },
      { url: 'https://img.com/fm.png', title: 'FM 结构图', pageUrl: 'https://a.com/fm' },
    ])
    expect(merged.searchQueries).toEqual(['FM 原理', 'FM 误区'])
  })

  it('配图按 URL 去重，旧笔记无 images 字段也能合并', () => {
    const legacy = {
      id: 'rn_2',
      nodeId: 'n_fm',
      concepts: [],
      derivations: [],
      examples: [],
      pitfalls: [],
      sources: [],
      searchQueries: [],
      version: 1,
      updatedAt: 'x',
    } as ResearchNote
    const merged = mergeResearchNotes(
      legacy,
      { ...patch, images: [{ url: 'https://img.com/fm.png' }, { url: 'https://img.com/b.png' }] },
      'n_fm',
    )
    expect(merged.images).toHaveLength(2)
  })
})

describe('extractPageImages 页面配图候选', () => {
  it('og:image 优先，过滤小图标，绝对化相对路径', () => {
    const html = `<html><head>
      <meta property="og:image" content="/og-cover.png">
      </head><body>
      <img src="https://cdn.example.com/arch.png" alt="架构图" width="800" height="600">
      <img src="/tiny-icon.png" width="16" height="16">
      <img src="data:image/png;base64,xx">
      <img src="diagram.svg" alt="相对路径图">
    </body></html>`
    const images = extractPageImages(new JSDOM(html, { url: 'https://example.com/post' }).window.document, 'https://example.com/post')
    expect(images.map((i) => i.url)).toEqual([
      'https://example.com/og-cover.png',
      'https://cdn.example.com/arch.png',
      'https://example.com/diagram.svg',
    ])
    expect(images[1].title).toBe('架构图')
  })
})

describe('searchImages 图片搜索', () => {
  it('双路合并去重、过滤小图、保留出处页', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(String(url))
      const body = JSON.parse(String(init?.body ?? '{}'))
      if (String(url).includes('tavily')) {
        return new Response(JSON.stringify({
          images: [
            { url: 'https://img.com/a.png', title: '图A', description: 'desc A' },
            { url: 'https://img.com/small.png', title: '图标' },
          ],
        }), { status: 200 })
      }
      void body
      return new Response(JSON.stringify({
        data: {
          images: {
            value: [
              { name: '图A-博查', contentUrl: 'https://img.com/a.png?utm_source=x', hostPageUrl: 'https://p.com/a', width: 640, height: 480 },
              { name: '图B', contentUrl: 'https://img.com/b.png', hostPageUrl: 'https://p.com/b', width: 20, height: 20 },
            ],
          },
        },
      }), { status: 200 })
    }))
    process.env.TAVILY_API_KEY = 'test-tavily'
    process.env.BOCHA_API_KEY = 'test-bocha'
    const images = await searchImages('双塔模型 结构图')
    expect(calls).toHaveLength(2)
    // 图A 去重（tavily 在前）；small 无尺寸但来自 tavily 保留？——small 有 title 无尺寸，见 usable 规则
    expect(images.map((i) => i.url).filter((u) => u.includes('/a.png'))).toEqual(['https://img.com/a.png'])
    expect(images.find((i) => i.url === 'https://img.com/b.png')).toBeUndefined() // 20x20 小图被过滤
    vi.unstubAllGlobals()
    delete process.env.TAVILY_API_KEY
    delete process.env.BOCHA_API_KEY
  })

  it('两家都无结果时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ images: [] }), { status: 200 })))
    process.env.TAVILY_API_KEY = 'test-tavily'
    process.env.BOCHA_API_KEY = 'test-bocha'
    await expect(searchImages('x')).rejects.toThrow(/无结果/)
    vi.unstubAllGlobals()
    delete process.env.TAVILY_API_KEY
    delete process.env.BOCHA_API_KEY
  })
})
