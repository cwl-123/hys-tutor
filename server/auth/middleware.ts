import type { IncomingMessage } from 'node:http'
import { HttpError } from './errors'
import { requireSession, type SessionUser } from './session'
import { getUserById } from './service'

const PUBLIC_API = new Set(['/health', '/auth/register', '/auth/login', '/auth/logout', '/auth/me'])

export function isPublicApi(url: string): boolean {
  return PUBLIC_API.has(url)
}

// 本地单用户模式：非 production 默认关闭登录，沿用 local 账号，避免开发/自用还要登录。
// 需要在本机验证登录流程时设 HYS_AUTH=on；公网 production 永远走真实会话。
export function isAuthDisabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.HYS_DEV_NO_AUTH === '1'
}

// 同源校验：SameSite=Lax 已挡大部分 CSRF，这里再校验 Origin/Referer 作为第二道
export function assertSameOrigin(req: IncomingMessage): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return
  const expected = process.env.APP_ORIGIN
  if (!expected) {
    // 本地开发/测试不强制；生产必须配置 APP_ORIGIN
    if (process.env.NODE_ENV !== 'production') return
    throw new HttpError(500, '服务端未配置 APP_ORIGIN')
  }
  const origin = req.headers.origin
  const referer = req.headers.referer
  let actual = origin ?? ''
  if (!actual && referer) {
    try {
      actual = new URL(referer).origin
    } catch {
      actual = ''
    }
  }
  if (actual !== expected) throw new HttpError(403, '跨站请求被拒绝')
}

export function requireAdmin(req: IncomingMessage): SessionUser {
  if (isAuthDisabled()) {
    const local = getUserById('local')
    if (local) return local
  }
  const user = requireSession(req)
  if (user.role !== 'admin') throw new HttpError(403, '需要管理员权限')
  return user
}
