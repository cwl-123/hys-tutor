// SSRF 防护：Agent 工具的抓取目标 URL 来自 LLM（可能被恶意网页 prompt-inject），
// 拦截内网/本机地址，防止探测内网或云 metadata 端点。
// 注意：域名解析后的 IP 不在此检查（本地单机场景容忍 DNS  rebinding 的残余风险）。

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === '::1' || h === '0.0.0.0' || h === '::') return true
  // IPv6 链路本地（fe80::/10）与 ULA（fc00::/7）
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  // IPv4-mapped IPv6（::ffff:1.2.3.4）
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  const ip = mapped ? mapped[1] : h
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false // 普通域名，放行
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  return false
}

// 校验并返回 URL；非法/私网地址抛错
export function assertPublicHttpUrl(raw: string): URL {
  const u = new URL(raw)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('仅支持 http/https 链接')
  }
  if (isPrivateHost(u.hostname)) throw new Error('不允许抓取内网/本机地址')
  return u
}
