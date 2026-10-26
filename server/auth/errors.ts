// 带 HTTP 状态码的业务异常：路由层统一映射，避免每个 handler 自己 if/else
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export class QuotaError extends HttpError {
  constructor(
    message: string,
    public readonly retryAfterSeconds = 3600,
  ) {
    super(429, message)
    this.name = 'QuotaError'
  }
}

export function statusOf(err: unknown): number {
  if (err instanceof HttpError) return err.status
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' && status >= 400 && status < 600 ? status : 500
}

export function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return '服务器内部错误'
}
