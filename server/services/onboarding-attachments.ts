// 开课对话附件：上传后落盘到 data/users/<uid>/onboarding/attachments/，
// 图片保留原文件供多模态预览，文档只保留抽取出的文本；24 小时后随下一次上传清理。
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  OnboardingAttachmentKind,
  OnboardingAttachmentMeta,
  OnboardingAttachmentRef,
} from '../../shared/types'
import { HttpError } from '../auth/errors'
import { dataPath, newId, nowIso, readJson, writeJson } from '../repo/json-store'
import { ASSET_MIME, detectImageExt } from './asset-store'
import { extractDocumentText } from './document-text'

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000
export const MAX_ATTACHMENTS_PER_MESSAGE = 3
export const MAX_TEXT_CHARS = 20_000
const MAX_KEPT_PER_USER = 20
const ID_RE = /^att_[a-f0-9]{8}$/

export interface StoredAttachment {
  id: string
  name: string
  kind: OnboardingAttachmentKind
  mime: string
  size: number
  format?: string
  chars?: number
  truncated?: boolean
  preview?: string
  text?: string
  imageFile?: string
  createdAt: string
}

export function attachmentDir(): string {
  return dataPath('onboarding', 'attachments')
}

function recordFile(dir: string, id: string): string {
  return path.join(dir, `${id}.json`)
}

// 文件名只用于展示与提示词，不允许带路径/控制字符
export function sanitizeFileName(input: string): string {
  const base = path.basename(String(input || ''))
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
  return (cleaned || '未命名文件').slice(0, 120)
}

export function publicAttachmentMeta(record: StoredAttachment): OnboardingAttachmentMeta {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    mime: record.mime,
    size: record.size,
    format: record.format,
    chars: record.chars,
    truncated: record.truncated,
    preview: record.preview,
    url: record.kind === 'image' ? `/api/onboarding/attachments/${record.id}` : undefined,
  }
}

// 上传：图片按魔数落原文件；文档抽取文本后只存文本，避免大文件常驻磁盘
export async function saveOnboardingAttachment(input: {
  name: string
  mime?: string
  buf: Buffer
}): Promise<OnboardingAttachmentMeta> {
  if (!input.buf.length) throw new HttpError(400, '文件是空的')
  if (input.buf.length > ATTACHMENT_MAX_BYTES) throw new HttpError(413, '文件不能超过 10MB')

  const name = sanitizeFileName(input.name)
  const dir = attachmentDir()
  await mkdir(dir, { recursive: true })
  await cleanupExpired(dir)
  await enforceCountLimit(dir)

  const id = newId('att')
  const imageExt = detectImageExt(input.buf)
  let record: StoredAttachment

  if (imageExt) {
    if (input.buf.length > IMAGE_MAX_BYTES) throw new HttpError(413, '图片不能超过 8MB')
    const imageFile = `${id}${imageExt}`
    await writeFile(path.join(dir, imageFile), input.buf)
    record = {
      id,
      name,
      kind: 'image',
      mime: ASSET_MIME[imageExt] ?? 'application/octet-stream',
      size: input.buf.length,
      format: imageExt.slice(1),
      imageFile,
      createdAt: nowIso(),
    }
  } else {
    const extracted = extractDocumentText(input.buf)
    if (!extracted) {
      throw new HttpError(415, '暂不支持这种文件，请上传图片、PDF、Word/PPT 或文本文件')
    }
    const text = extracted.text.trim()
    if (!text) {
      const hint =
        extracted.format === 'pdf'
          ? '这份 PDF 没有可提取的文字（可能是扫描件），请把关键页截图后上传'
          : '没能从这份文件里读出文字，换一份文件或截图上传试试'
      throw new HttpError(422, hint)
    }
    const truncated = text.length > MAX_TEXT_CHARS
    record = {
      id,
      name,
      kind: 'text',
      mime: input.mime?.trim() || 'text/plain',
      size: input.buf.length,
      format: extracted.format,
      chars: text.length,
      truncated,
      text: text.slice(0, MAX_TEXT_CHARS),
      preview: text.slice(0, 160).replace(/\s+/g, ' '),
      createdAt: nowIso(),
    }
  }

  await writeJson(recordFile(dir, id), record)
  return publicAttachmentMeta(record)
}

export async function readOnboardingAttachment(id: string): Promise<StoredAttachment | null> {
  if (!ID_RE.test(id)) return null
  return readJson<StoredAttachment | null>(recordFile(attachmentDir(), id), null)
}

export async function readOnboardingAttachmentImage(
  id: string,
): Promise<{ buf: Buffer; mime: string } | null> {
  const record = await readOnboardingAttachment(id)
  if (!record || record.kind !== 'image' || !record.imageFile) return null
  try {
    const buf = await readFile(path.join(attachmentDir(), record.imageFile))
    return { buf, mime: record.mime }
  } catch {
    return null
  }
}

export async function deleteOnboardingAttachment(id: string): Promise<void> {
  if (!ID_RE.test(id)) return
  const dir = attachmentDir()
  const record = await readJson<StoredAttachment | null>(recordFile(dir, id), null)
  if (record?.imageFile) await unlink(path.join(dir, record.imageFile)).catch(() => {})
  await unlink(recordFile(dir, id)).catch(() => {})
}

// 按引用批量取附件；已被清理/伪造的 id 直接跳过，不阻断整轮对话
export async function loadOnboardingAttachments(
  refs: OnboardingAttachmentRef[] | undefined,
): Promise<StoredAttachment[]> {
  if (!refs?.length) return []
  const out: StoredAttachment[] = []
  for (const ref of refs.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
    const record = await readOnboardingAttachment(ref.id)
    if (record) out.push(record)
  }
  return out
}

export async function readAttachmentImageDataUrl(record: StoredAttachment): Promise<string | null> {
  if (record.kind !== 'image' || !record.imageFile) return null
  try {
    const buf = await readFile(path.join(attachmentDir(), record.imageFile))
    return `data:${record.mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

async function cleanupExpired(dir: string): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  const now = Date.now()
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = path.join(dir, name)
    const info = await stat(file).catch(() => null)
    if (info && now - info.mtimeMs > ATTACHMENT_TTL_MS) {
      await deleteOnboardingAttachment(name.slice(0, -'.json'.length))
    }
  }
}

async function enforceCountLimit(dir: string): Promise<void> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.json'))
  if (names.length < MAX_KEPT_PER_USER) return
  const withTime = await Promise.all(
    names.map(async (name) => ({
      name,
      mtime: (await stat(path.join(dir, name)).catch(() => null))?.mtimeMs ?? 0,
    })),
  )
  withTime.sort((a, b) => a.mtime - b.mtime)
  const removeCount = withTime.length - MAX_KEPT_PER_USER + 1
  for (const item of withTime.slice(0, removeCount)) {
    await deleteOnboardingAttachment(item.name.slice(0, -'.json'.length))
  }
}
