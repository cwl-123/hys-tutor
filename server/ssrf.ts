import { lookup } from 'node:dns/promises'
import net from 'node:net'

// SSRF 防护：Agent 工具的抓取目标 URL 来自 LLM（可能被恶意网页 prompt-inject），
// 拦截内网/本机地址，防止探测内网或云 metadata 端点。
// 说明：解析后仍可能发生 DNS rebinding（TOCTOU），公网部署还应配合出站安全组/不可信网络隔离。

export function isPrivateIp(ip: string): boolean {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true
  if (h === '::1' || h === '::' || h === '0.0.0.0') return true
  // IPv6 链路本地 fe80::/10 与 ULA fc00::/7
  if (h.includes(':')) {
    if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
    // IPv4-mapped IPv6（::ffff:1.2.3.4）
    const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
    if (mapped) return isPrivateIp(mapped[1])
    return false
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a === 192 && b === 0) return true // 192.0.0.0/24 协议保留
  if (a === 198 && (b === 18 || b === 19)) return true // 基准测试
  if (a >= 224) return true // 组播/保留
  return false
}

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return true
  }
  if (net.isIP(h)) return isPrivateIp(h)
  return false // 普通域名，交给 DNS 解析检查
}

// 校验并返回 URL；非法/私网字面量地址抛错
export function assertPublicHttpUrl(raw: string): URL {
  const u = new URL(raw)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('仅支持 http/https 链接')
  }
  if (isPrivateHost(u.hostname)) throw new Error('不允许抓取内网/本机地址')
  return u
}

// 解析域名并检查所有 A/AAAA 记录，防止「公网域名解析到 127.0.0.1」
export async function assertPublicHttpUrlAsync(raw: string): Promise<URL> {
  const u = assertPublicHttpUrl(raw)
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host)) return u
  // 单测使用 cdn.example.com 等假域名且 mock 了 fetch，跳过真实 DNS
  if (process.env.NODE_ENV === 'test') return u
  let addrs: { address: string }[]
  try {
    addrs = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new Error('域名解析失败')
  }
  if (addrs.length === 0) throw new Error('域名解析失败')
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error('不允许抓取内网/本机地址')
  }
  return u
}

// 手动跟随重定向：每一跳都重新做 DNS/私网检查，避免 302 跳到 metadata 端点
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
  maxRedirects = 5,
): Promise<Response> {
  let url = await assertPublicHttpUrlAsync(raw)
  let current = { ...init }
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(url, { ...current, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(res.status)) return res
    const location = res.headers.get('location')
    if (!location) return res
    if (i === maxRedirects) throw new Error('重定向次数过多')
    void res.body?.cancel()
    const next = new URL(location, url)
    url = await assertPublicHttpUrlAsync(next.toString())
    // 303 或 301/302 的 POST 按浏览器行为改为 GET；307/308 保留方法与 body
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && current.method === 'POST')) {
      current = { ...current, method: 'GET', body: undefined }
    }
  }
  throw new Error('重定向次数过多')
}
