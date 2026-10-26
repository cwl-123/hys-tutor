import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertPublicHttpUrl, isPrivateHost, safeFetch } from '../server/ssrf'

afterEach(() => vi.unstubAllGlobals())

describe('SSRF 私网判定', () => {
  it('拦截本机/内网/metadata 字面量', () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://localhost:5180/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/',
      'http://172.16.0.1/',
      'http://192.168.1.1/',
      'http://100.64.0.1/',
      'http://[::1]/',
      'http://[fe80::1]/',
      'http://foo.local/',
      'file:///etc/passwd',
    ]) {
      expect(() => assertPublicHttpUrl(url), url).toThrow()
    }
  })

  it('普通域名/公网 IP 放行', () => {
    expect(isPrivateHost('fcbarcelona.com')).toBe(false)
    expect(isPrivateHost('example.com')).toBe(false)
    expect(isPrivateHost('8.8.8.8')).toBe(false)
    expect(() => assertPublicHttpUrl('https://example.com/a')).not.toThrow()
  })
})

describe('safeFetch 重定向', () => {
  it('302 跳到内网时拒绝，不发起第二跳', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string | URL) => {
      calls.push(String(url))
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:5180/api/health' },
      })
    })
    await expect(safeFetch('https://example.com/a')).rejects.toThrow(/内网/)
    expect(calls).toHaveLength(1)
  })

  it('正常 200 直接返回', async () => {
    vi.stubGlobal('fetch', async () => new Response('ok', { status: 200 }))
    const res = await safeFetch('https://example.com/a')
    expect(res.status).toBe(200)
  })
})
