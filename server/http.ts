import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpError } from './auth/errors'

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

// 统一读 JSON body：2MB 上限 + 解析失败返回 400（避免抛到 500）
export async function readBody<T>(req: IncomingMessage): Promise<T> {
  const max = Number(process.env.MAX_BODY_BYTES || 2 * 1024 * 1024)
  const raw = (await readRawBody(req, max)).toString('utf-8')
  try {
    return JSON.parse(raw || '{}') as T
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}

// 原始字节 body（文件上传用）：显式传上限，超限直接 413
export async function readRawBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > max) throw new HttpError(413, '请求体过大')
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}
