import { getSettings, resolveSearchKeys } from '../../services/settings-service'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  provider: 'tavily' | 'bocha'
}

export type SearchProvider = SearchResult['provider']

const SEARCH_TIMEOUT_MS = 15_000

// URL 归一化用于去重：去 hash、去 utm 参数、去尾部斜杠
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) u.searchParams.delete(key)
    }
    return u.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

// 多路结果合并：按归一化 URL 去重，保持各路原始排序（先传入的优先）
export function mergeSearchResults(...lists: SearchResult[][]): SearchResult[] {
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const list of lists) {
    for (const r of list) {
      const key = normalizeUrl(r.url)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(r)
    }
  }
  return out
}

async function tavilySearch(query: string, maxResults: number, apiKey: string): Promise<SearchResult[]> {
  if (!apiKey) return []
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`)
  const data = (await res.json()) as { results?: { title: string; url: string; content?: string }[] }
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: (r.content ?? '').slice(0, 300),
    provider: 'tavily' as const,
  }))
}

async function bochaSearch(query: string, count: number, apiKey: string): Promise<SearchResult[]> {
  if (!apiKey) return []
  const res = await fetch('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, count, summary: true }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`博查 HTTP ${res.status}`)
  const data = (await res.json()) as {
    data?: { webPages?: { value?: { name: string; url: string; snippet?: string; summary?: string }[] } }
  }
  return (data.data?.webPages?.value ?? []).map((r) => ({
    title: r.name,
    url: r.url,
    snippet: (r.summary || r.snippet || '').slice(0, 300),
    provider: 'bocha' as const,
  }))
}

// 按 query 语言选主/次搜索源：实测中文命中博查更稳、英文命中 Tavily 更准。
// 主源结果排前、次源仅作补充与交叉验证（后续相关性过滤会剔除串台噪音）。
export function routeProviders(query: string): { primary: SearchProvider; secondary: SearchProvider } {
  const hasCjk = /[\u3400-\u9fff\uf900-\ufaff]/.test(query)
  return hasCjk
    ? { primary: 'bocha', secondary: 'tavily' }
    : { primary: 'tavily', secondary: 'bocha' }
}

// 双路并行搜索 + 按语言路由排序 + 去重合并；两家都失败/无结果才抛错
export async function searchWeb(query: string, maxPerProvider = 5): Promise<SearchResult[]> {
  const keys = resolveSearchKeys(getSettings())
  if (!keys.tavilyKey && !keys.bochaKey) {
    throw new Error('未配置搜索 API Key：请在「设置」中填写 Tavily / 博查 Key（或用 .env）')
  }
  const { primary, secondary } = routeProviders(query)
  const run = (p: SearchProvider) =>
    p === 'tavily'
      ? tavilySearch(query, maxPerProvider, keys.tavilyKey)
      : bochaSearch(query, maxPerProvider, keys.bochaKey)

  const [pRes, sRes] = await Promise.allSettled([run(primary), run(secondary)])
  const merged = mergeSearchResults(
    pRes.status === 'fulfilled' ? pRes.value : [],
    sRes.status === 'fulfilled' ? sRes.value : [],
  )
  if (merged.length === 0) {
    const reasons = [pRes, sRes]
      .map((r) => (r.status === 'rejected' ? String(r.reason) : ''))
      .filter(Boolean)
      .join('；')
    throw new Error(`搜索无结果${reasons ? `（${reasons}）` : ''}`)
  }
  return merged
}
