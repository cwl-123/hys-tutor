import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { sendJson } from '../index'
import { ASSET_MIME, isSafeAssetName, readAsset } from '../services/asset-store'

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
