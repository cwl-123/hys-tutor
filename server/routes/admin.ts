import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { sendJson, readBody } from '../http'
import { requireAdmin } from '../auth/middleware'
import { listUsers, resetPasswordByAdmin, setUserStatus } from '../auth/service'
import { createInvites } from '../auth/invite'
import { getGlobalSpendToday } from '../services/quota-service'
import { getDb } from '../db'

export async function handleAdminUsers(req: IncomingMessage, res: ServerResponse): Promise<void> {
  requireAdmin(req)
  sendJson(res, 200, { users: listUsers() })
}

const patchUserSchema = z.object({
  status: z.enum(['active', 'disabled']).optional(),
})

export async function handleAdminUser(
  req: IncomingMessage,
  res: ServerResponse,
  userId: string,
): Promise<void> {
  requireAdmin(req)
  const body = patchUserSchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: '参数不合法' })
    return
  }
  if (body.data.status) setUserStatus(userId, body.data.status)
  sendJson(res, 200, { ok: true })
}

const resetSchema = z.object({ password: z.string().min(8).max(128) })

export async function handleAdminResetPassword(
  req: IncomingMessage,
  res: ServerResponse,
  userId: string,
): Promise<void> {
  requireAdmin(req)
  const body = resetSchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: '临时密码至少 8 位' })
    return
  }
  await resetPasswordByAdmin(userId, body.data.password)
  sendJson(res, 200, { ok: true })
}

const inviteSchema = z.object({
  count: z.number().int().min(1).max(50).optional(),
  days: z.number().int().min(1).max(90).optional(),
  note: z.string().max(100).optional(),
})

export async function handleAdminInvites(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const admin = requireAdmin(req)
  const body = inviteSchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: '参数不合法' })
    return
  }
  const invites = createInvites({
    count: body.data.count ?? 1,
    days: body.data.days ?? 7,
    note: body.data.note,
    createdBy: admin.id,
  })
  sendJson(res, 200, { invites })
}

export async function handleAdminStats(req: IncomingMessage, res: ServerResponse): Promise<void> {
  requireAdmin(req)
  const userCount = getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  const activeSessions = getDb()
    .prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?')
    .get(new Date().toISOString()) as { n: number }
  sendJson(res, 200, {
    users: Number(userCount.n),
    activeSessions: Number(activeSessions.n),
    spendToday: getGlobalSpendToday(),
    today: new Date().toISOString().slice(0, 10),
  })
}
