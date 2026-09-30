import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'

export interface FetchedPage {
  url: string
  title: string
  text: string
}

const FETCH_TIMEOUT_MS = 20_000
export const MAX_TEXT_CHARS = 6000
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

// 用 readability 提取正文，失败时退化为 body 全文
export function extractMainContent(html: string, url: string): { title: string; text: string } {
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
  return { title, text: text.replace(/\n{3,}/g, '\n\n').trim() }
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
  const { title, text } = extractMainContent(html, url)
  if (!text) throw new Error('未提取到正文')
  return { url, title, text: text.slice(0, MAX_TEXT_CHARS) }
}
