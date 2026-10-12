// 统一错误消息提取（前后端共用），替代散落的 err instanceof Error 三元表达式
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
