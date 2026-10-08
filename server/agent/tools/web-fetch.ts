import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'

export interface FetchedPage {
  url: string
  title: string
  text: string
  images: PageImage[]
}

export interface PageImage {
  url: string
  title?: string
}

const FETCH_TIMEOUT_MS = 20_000
export const MAX_TEXT_CHARS = 6000
export const MAX_PAGE_IMAGES = 6
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

// 页面配图候选：og:image 优先，再取正文 <img>；跳过小图标
export function extractPageImages(doc: Document, baseUrl: string): PageImage[] {
  const out: PageImage[] = []
  const seen = new Set<string>()
  const push = (raw: string | null, title?: string) => {
    if (!raw || out.length >= MAX_PAGE_IMAGES) return
    try {
      const u = new URL(raw, baseUrl)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return
      const key = u.toString()
      if (seen.has(key)) return
      seen.add(key)
      out.push({ url: key, title: title || undefined })
    } catch {
      // 非法 URL 跳过
    }
  }
  for (const m of doc.querySelectorAll('meta[property="og:image"], meta[name="og:image"]')) {
    push(m.getAttribute('content'))
  }
  for (const img of doc.querySelectorAll('img')) {
    const w = Number(img.getAttribute('width') ?? 0)
    const h = Number(img.getAttribute('height') ?? 0)
    if ((w && w < 80) || (h && h < 80)) continue
    push(img.getAttribute('src'), img.getAttribute('alt') ?? undefined)
  }
  return out
}

// 用 readability 提取正文，失败时退化为 body 全文
export function extractMainContent(html: string, url: string): { title: string; text: string; images: PageImage[] } {
  const dom = new JSDOM(html, { url })
  let title = dom.window.document.title || url
  let text = ''
  try {
    const article = new Readability(dom.window.document).parse()
    if (article?.textContent) {
      title = article.title || title
      text = article.textContent
    }
  } catch {
    // readability 解析失败，走退化路径
  }
  if (!text.trim()) text = dom.window.document.body?.textContent ?? ''
  const images = extractPageImages(dom.window.document, url)
  return { title, text: text.replace(/\n{3,}/g, '\n\n').trim(), images }
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    throw new Error(`不支持的内容类型：${contentType || '未知'}`)
  }
  const html = await res.text()
  const { title, text, images } = extractMainContent(html, url)
  if (!text) throw new Error('未提取到正文')
  return { url, title, text: text.slice(0, MAX_TEXT_CHARS), images }
}
