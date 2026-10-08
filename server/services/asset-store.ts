// 课件配图素材库：按课题落到 data/topics/<tid>/assets/，内容哈希命名天然去重
// 课件正文统一引用 /api/topics/<tid>/assets/<file>，原图直链记入 assets.json 供图注来源
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { dataPath, nowIso, readJson, writeJson } from '../repo/json-store'
import type { LessonImage } from '../../shared/types'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const DOWNLOAD_TIMEOUT_MS = 20_000

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

// 只认这四种位图：拒 SVG（脚本载体），图示走 Mermaid
export const ASSET_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export interface AssetMeta {
  originUrl?: string // 原图直链
  title?: string
  pageUrl?: string // 图所在网页（来源页）
  size: number
  createdAt: string
}

export type AssetManifest = Record<string, AssetMeta>

export interface SavedImage {
  src: string // 课件引用路径
  file: string
  meta: AssetMeta
}

export function assetsDir(topicId: string): string {
  return dataPath('topics', topicId, 'assets')
}

export function manifestFile(topicId: string): string {
  return dataPath('topics', topicId, 'assets.json')
}

// 素材文件名只允许简单字符，防路径穿越
export function isSafeAssetName(file: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) && !file.includes('..')
}

export function assetSrc(topicId: string, file: string): string {
  return `/api/topics/${topicId}/assets/${file}`
}

export function assetFileOfSrc(src: string): string | null {
  const m = src.match(/\/assets\/([^/?#]+)$/)
  return m ? m[1] : null
}

// 魔数嗅探图片类型（不信任 Content-Type）
export function detectImageExt(buf: Buffer): '.png' | '.jpg' | '.gif' | '.webp' | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return '.png'
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg'
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('latin1') === 'GIF87a' || buf.subarray(0, 6).toString('latin1') === 'GIF89a')) {
    return '.gif'
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return '.webp'
  }
  return null
}

export async function readManifest(topicId: string): Promise<AssetManifest> {
  return readJson<AssetManifest>(manifestFile(topicId), {})
}

// 落盘一张图（下载/上传共用）：哈希命名去重，清单记来源；非法/超限返回 null
export async function saveImageBuffer(
  topicId: string,
  buf: Buffer,
  meta: { originUrl?: string; title?: string; pageUrl?: string },
): Promise<SavedImage | null> {
  if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null
  const ext = detectImageExt(buf)
  if (!ext) return null
  const file = `${createHash('sha256').update(buf).digest('hex').slice(0, 16)}${ext}`
  await mkdir(assetsDir(topicId), { recursive: true })
  await writeFile(path.join(assetsDir(topicId), file), buf)

  const manifest = await readManifest(topicId)
  const prev = manifest[file]
  manifest[file] = {
    originUrl: meta.originUrl ?? prev?.originUrl,
    title: meta.title ?? prev?.title,
    pageUrl: meta.pageUrl ?? prev?.pageUrl,
    size: buf.length,
    createdAt: prev?.createdAt ?? nowIso(),
  }
  await writeJson(manifestFile(topicId), manifest)
  return { src: assetSrc(topicId, file), file, meta: manifest[file] }
}

// 下载外链图到本地：任何失败（超时/防盗链/非图片/超限）都返回 null，由调用方决定剔除或保留
export async function downloadImage(
  topicId: string,
  url: string,
  meta: { title?: string; pageUrl?: string } = {},
): Promise<SavedImage | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_IMAGE_BYTES) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return await saveImageBuffer(topicId, buf, { originUrl: url, ...meta })
  } catch {
    return null
  }
}

export async function readAsset(topicId: string, file: string): Promise<Buffer | null> {
  if (!isSafeAssetName(file)) return null
  try {
    return await readFile(path.join(assetsDir(topicId), file))
  } catch {
    return null
  }
}

// ---------- 正文配图后处理 ----------

// 与 markdown-it 图片语法对齐：![alt](src)，src 内不含空白
const IMAGE_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g

function isLocalAssetSrc(topicId: string, src: string): boolean {
  const file = assetFileOfSrc(src)
  return !!file && isSafeAssetName(file) && src === assetSrc(topicId, file)
}

export interface LocalizeResult {
  contentMd: string
  images: LessonImage[]
}

/**
 * 落图后处理：正文中的外链图下载落地并改写为本地路径，同时收集配图清单。
 * - 已是本地素材路径 → 保留
 * - 外链下载失败 / 未知来源：dropFailed=true（备课产线，防 LLM 编造 URL）→ 剔除；false（手动编辑）→ 原样保留
 * - 代码块（``` 围栏）内的图片语法不动，避免改写教学示例
 */
export async function localizeImages(
  topicId: string,
  contentMd: string,
  opts: { dropFailed?: boolean } = {},
): Promise<LocalizeResult> {
  const dropFailed = opts.dropFailed ?? true
  const manifest = await readManifest(topicId)
  const images: LessonImage[] = []
  const outLines: string[] = []
  let inFence = false

  for (const line of contentMd.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      outLines.push(line)
      continue
    }
    if (inFence) {
      outLines.push(line)
      continue
    }

    let out = ''
    let last = 0
    for (const m of line.matchAll(IMAGE_RE)) {
      const [full, alt, src] = m
      const start = m.index ?? 0
      out += line.slice(last, start)
      last = start + full.length

      let keepSrc: string | null = null
      let meta: AssetMeta | undefined
      if (isLocalAssetSrc(topicId, src)) {
        keepSrc = src
        meta = manifest[assetFileOfSrc(src) ?? '']
      } else if (/^https?:\/\//i.test(src)) {
        const saved = await downloadImage(topicId, src, { title: alt || undefined })
        if (saved) {
          keepSrc = saved.src
          meta = saved.meta
        }
      }
      if (!keepSrc) {
        if (dropFailed) continue
        out += full
        images.push({ src, alt: alt || undefined })
        continue
      }

      out += `![${alt}](${keepSrc})`
      images.push({ src: keepSrc, alt: alt || undefined, originUrl: meta?.originUrl, pageUrl: meta?.pageUrl })
    }
    out += line.slice(last)
    outLines.push(out)
  }

  return { contentMd: outLines.join('\n'), images }
}
