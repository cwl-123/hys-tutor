import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { errMsg } from '../../shared/error'
import { readBody, readRawBody, sendJson } from '../http'
import { currentUserId } from '../repo/context'
import { consumeQuota } from '../services/quota-service'
import { statusOf } from '../auth/errors'
import { chatOnboarding } from '../services/onboarding-service'
import {
  ATTACHMENT_MAX_BYTES,
  deleteOnboardingAttachment,
  readOnboardingAttachmentImage,
  saveOnboardingAttachment,
} from '../services/onboarding-attachments'

const attachmentRefSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  kind: z.enum(['image', 'text']),
})

const onboardingChatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(2000),
        attachments: z.array(attachmentRefSchema).max(3).optional(),
      }),
    )
    .min(1)
    .max(30),
})

// POST /api/onboarding/chat — 开课对话（AI 引导理清学习方向，产出方向提案）
export async function handleOnboardingChat(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = onboardingChatBodySchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: body.error.issues.map((i) => i.message).join('；') })
    return
  }
  if (
    body.data.messages.some((m) => m.role === 'user' && !m.content.trim() && !m.attachments?.length)
  ) {
    sendJson(res, 400, { error: '消息内容不能为空' })
    return
  }
  try {
    const userId = currentUserId()
    consumeQuota(userId, 'chat')
    const result = await chatOnboarding(body.data.messages)
    sendJson(res, 200, result)
  } catch (err) {
    const status = statusOf(err)
    sendJson(res, status, { error: status >= 500 ? '服务器内部错误' : errMsg(err) })
  }
}

function decodeFileName(raw: string | string[] | undefined): string {
  const header = Array.isArray(raw) ? raw[0] : raw
  if (!header) return '未命名文件'
  try {
    return decodeURIComponent(header)
  } catch {
    return header
  }
}

// POST /api/onboarding/attachments — 上传开课附件（文件名走 X-File-Name，body 为原始字节）
export async function handleUploadOnboardingAttachment(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const declared = Number(req.headers['content-length'] ?? 0)
    if (declared > ATTACHMENT_MAX_BYTES) {
      sendJson(res, 413, { error: '文件不能超过 10MB' })
      return
    }
    const buf = await readRawBody(req, ATTACHMENT_MAX_BYTES + 1024)
    const meta = await saveOnboardingAttachment({
      name: decodeFileName(req.headers['x-file-name']),
      mime: String(req.headers['content-type'] ?? ''),
      buf,
    })
    sendJson(res, 200, meta)
  } catch (err) {
    const status = statusOf(err)
    sendJson(res, status, { error: status >= 500 ? '服务器内部错误' : errMsg(err) })
  }
}

// GET/HEAD /api/onboarding/attachments/:id — 图片附件预览（文档不提供直出）
export async function handleGetOnboardingAttachment(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  const image = await readOnboardingAttachmentImage(id)
  if (!image) {
    sendJson(res, 404, { error: '附件不存在或已过期' })
    return
  }
  res.statusCode = 200
  res.setHeader('Content-Type', image.mime)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Length', String(image.buf.length))
  res.end(req.method === 'HEAD' ? undefined : image.buf)
}

// DELETE /api/onboarding/attachments/:id — 用户移除待发送附件时尽力清理
export async function handleDeleteOnboardingAttachment(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  await deleteOnboardingAttachment(id)
  sendJson(res, 200, { ok: true })
}
