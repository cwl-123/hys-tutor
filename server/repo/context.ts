import { AsyncLocalStorage } from 'node:async_hooks'
import { HttpError } from '../auth/errors'

// 请求级用户上下文：路由层进入时 runAsUser(userId, ...)，repo 层据此把数据写进
// data/users/<uid>/。用 ALS 而不是给 18 个 service 逐个加参数，改造面最小。
interface UserContext {
  userId: string
}

const als = new AsyncLocalStorage<UserContext>()

export function runAsUser<T>(userId: string, fn: () => T): T {
  return als.run({ userId }, fn)
}

// 只在确实有请求上下文时返回用户 id；后台计量等场景用它判断是否需要写库
export function currentUserIdOrNull(): string | null {
  return als.getStore()?.userId ?? null
}

export function currentUserId(): string {
  const uid = als.getStore()?.userId
  if (uid) return uid
  // 本地开发/单测兼容；生产环境必须显式登录，绝不回退到全局目录
  if (process.env.NODE_ENV !== 'production') {
    return process.env.HYS_DEFAULT_USER || 'local'
  }
  throw new HttpError(401, '未登录')
}

const USER_ID_RE = /^[a-zA-Z0-9_-]{3,40}$/

// 防路径穿越：用户 id 只允许字母数字下划线中划线
export function safeUserId(userId: string): string {
  if (!USER_ID_RE.test(userId)) throw new Error('非法用户 id')
  return userId
}
