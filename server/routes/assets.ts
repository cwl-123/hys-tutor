import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { sendJson } from '../index'
import {
  ASSET_MIME,
  MAX_IMAGE_BYTES,
  isSafeAssetName,
  readAsset,
  saveImageBuffer,
} from '../services/asset-store'

async function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const c of req) {
    const buf = c as Buffer
    total += buf.length
    if (total > limit) throw new Error(`图片超过大小限制（${Math.round(limit / 1024 / 1024)}MB）`)
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

// GET/HEAD /api/topics/:tid/assets/:file — 课件配图静态资源（文件名含内容哈希，可长期缓存）
export async function handleGetAsset(
  req: IncomingMessage,
  res: ServerResponse,
  topicId: string,
  file: string,
): Promise<void> {
  if (!isSafeAssetName(file)) {
    sendJson(res, 400, { error: '非法文件名' })
    return
  }
  const buf = await readAsset(topicId, file)
  if (!buf) {
    sendJson(res, 404, { error: '图片不存在' })
    return
  }
  res.statusCode = 200
  res.setHeader('Content-Type', ASSET_MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.setHeader('Content-Length', String(buf.length))
  res.end(req.method === 'HEAD' ? undefined : buf)
}

// POST /api/topics/:tid/assets — 上传图片（raw image/* body，粘贴/拖拽截图走这里）
export async function handleUploadAsset(
  req: IncomingMessage,
  res: ServerResponse,
  topicId: string,
): Promise<void> {
  let buf: Buffer
  try {
    buf = await readRawBody(req, MAX_IMAGE_BYTES)
  } catch (err) {
    sendJson(res, 413, { error: err instanceof Error ? err.message : String(err) })
    return
  }
  const saved = await saveImageBuffer(topicId, buf, {})
  if (!saved) {
    sendJson(res, 400, { error: '仅支持 PNG / JPEG / GIF / WEBP 图片，且不超过 5MB' })
    return
  }
  sendJson(res, 200, { src: saved.src, file: saved.file })
}
