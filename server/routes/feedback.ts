import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { sendJson, readBody } from '../http'
import { getDb } from '../db'
import { currentUserId } from '../repo/context'
import { rateLimit } from '../auth/rate-limit'

const feedbackSchema = z.object({
  kind: z.enum(['bug', 'content', 'suggestion', 'other']).default('other'),
  body: z.string().trim().min(2).max(2000),
  page: z.string().trim().max(300).optional(),
  targetId: z.string().trim().max(80).optional(),
  contact: z.string().trim().max(120).optional(),
})

// POST /api/feedback — 登录用户提交问题/建议；落 SQLite，管理员可在后台查看
export async function handleCreateFeedback(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const userId = currentUserId()
  rateLimit(`feedback:${userId}`, 10, 60 * 60_000)
  const parsed = feedbackSchema.safeParse(await readBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: parsed.error.issues.map((i) => i.message).join('；') })
    return
  }
  const id = `fb_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  getDb()
    .prepare(
      `INSERT INTO feedback (id, user_id, kind, page, target_id, body, contact, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(
      id,
      userId,
      parsed.data.kind,
      parsed.data.page ?? null,
      parsed.data.targetId ?? null,
      parsed.data.body,
      parsed.data.contact ?? null,
      new Date().toISOString(),
    )
  sendJson(res, 200, { ok: true, id })
}
