import { getSettings, resolveSearchKeys } from '../../services/settings-service'
import { normalizeUrl } from './web-search'

export interface ImageResult {
  url: string // 原图直链
  title?: string
  pageUrl?: string // 图所在网页（来源页）
  width?: number
  height?: number
  provider: 'tavily' | 'bocha'
}

const SEARCH_TIMEOUT_MS = 15_000
const MIN_DIM = 80 // 过滤小图标/像素点

function usable(img: ImageResult): boolean {
  if (!/^https?:/i.test(img.url)) return false
  if (img.width && img.width < MIN_DIM) return false
  if (img.height && img.height < MIN_DIM) return false
  return true
}

async function tavilyImages(query: string, max: number, apiKey: string): Promise<ImageResult[]> {
  if (!apiKey) return []
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 3,
      include_images: true,
      include_image_descriptions: true,
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`)
  const data = (await res.json()) as {
    images?: ({ url?: string; title?: string; description?: string } | string)[]
  }
  return (data.images ?? [])
    .slice(0, max)
    .map((img) => {
      const o = typeof img === 'string' ? { url: img } : img
      return {
        url: o.url ?? '',
        title: o.title || o.description || undefined,
        provider: 'tavily' as const,
      }
    })
    .filter((img) => img.url)
}

async function bochaImages(query: string, max: number, apiKey: string): Promise<ImageResult[]> {
  if (!apiKey) return []
  const res = await fetch('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, count: 3 }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`博查 HTTP ${res.status}`)
  const data = (await res.json()) as {
    data?: {
      images?: {
        value?: {
          name?: string
          contentUrl?: string
          hostPageUrl?: string
          width?: number
          height?: number
        }[]
      }
    }
  }
  return (data.data?.images?.value ?? [])
    .slice(0, max)
    .map((r) => ({
      url: r.contentUrl ?? '',
      title: r.name ?? undefined,
      pageUrl: r.hostPageUrl ?? undefined,
      width: r.width,
      height: r.height,
      provider: 'bocha' as const,
    }))
    .filter((img) => img.url)
}

// 双路并行图片搜索 + 去重合并（与 web_search 同策略，互为降级）
export async function searchImages(query: string, maxPerProvider = 6): Promise<ImageResult[]> {
  const keys = resolveSearchKeys(getSettings())
  if (!keys.tavilyKey && !keys.bochaKey) {
    throw new Error('未配置搜索 API Key：请在「设置」中填写 Tavily / 博查 Key（或用 .env）')
  }
  const [tavily, bocha] = await Promise.allSettled([
    tavilyImages(query, maxPerProvider, keys.tavilyKey),
    bochaImages(query, maxPerProvider, keys.bochaKey),
  ])
  const seen = new Set<string>()
  const out: ImageResult[] = []
  for (const list of [
    tavily.status === 'fulfilled' ? tavily.value : [],
    bocha.status === 'fulfilled' ? bocha.value : [],
  ]) {
    for (const img of list) {
      const key = normalizeUrl(img.url)
      if (seen.has(key) || !usable(img)) continue
      seen.add(key)
      out.push(img)
    }
  }
  if (out.length === 0) {
    const reasons = [tavily, bocha]
      .map((r) => (r.status === 'rejected' ? String(r.reason) : ''))
      .filter(Boolean)
      .join('；')
    throw new Error(`图片搜索无结果${reasons ? `（${reasons}）` : ''}`)
  }
  return out
}
