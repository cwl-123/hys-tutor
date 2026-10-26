import { HttpError } from './errors'

// 进程内滑动窗口限流：单进程部署足够；多实例时必须换成 Redis/Nginx。
const buckets = new Map<string, number[]>()

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now()
  const from = now - windowMs
  const hits = (buckets.get(key) ?? []).filter((t) => t > from)
  if (hits.length >= limit) {
    const retry = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000))
    throw new HttpError(429, `操作过于频繁，请 ${retry} 秒后再试`)
  }
  hits.push(now)
  buckets.set(key, hits)
  // 简单防内存膨胀：超过 1 万个 key 时清掉已过期的
  if (buckets.size > 10_000) {
    for (const [k, arr] of buckets) {
      if (arr.every((t) => t <= from)) buckets.delete(k)
    }
  }
}
