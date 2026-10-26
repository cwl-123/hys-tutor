import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { sendJson, readBody } from '../http'
import {
  requireSession,
  createSession,
  destroySession,
  optionalSession,
  clientIp,
} from '../auth/session'
import { changePassword, loginUser, registerUser } from '../auth/service'
import { getUsage } from '../services/quota-service'
import { rateLimit } from '../auth/rate-limit'

const registerSchema = z.object({
  inviteCode: z.string().trim().min(4).max(32),
  nickname: z.string().trim().min(2).max(20),
  password: z.string().min(8).max(128),
  acceptedTerms: z.literal(true, { message: '请先同意用户协议与隐私政策' }),
})

export async function handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
  rateLimit(`register:${clientIp(req)}`, 10, 60 * 60_000)
  const body = registerSchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: body.error.issues.map((i) => i.message).join('；') })
    return
  }
  const user = await registerUser(body.data)
  createSession(user.id, req, res)
  sendJson(res, 200, { user, usage: getUsage(user.id) })
}

const loginSchema = z.object({
  nickname: z.string().trim().min(1).max(20),
  password: z.string().min(1).max(128),
})

export async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  rateLimit(`login:${clientIp(req)}`, 20, 15 * 60_000)
  const body = loginSchema.safeParse(await readBody(req))
  if (body.success) {
    rateLimit(`login-nick:${body.data.nickname.toLowerCase()}`, 8, 15 * 60_000)
  }
  if (!body.success) {
    sendJson(res, 400, { error: '请输入昵称和密码' })
    return
  }
  const user = await loginUser(body.data.nickname, body.data.password)
  createSession(user.id, req, res)
  sendJson(res, 200, { user, usage: getUsage(user.id) })
}

export async function handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  destroySession(req, res)
  sendJson(res, 200, { ok: true })
}

export async function handleMe(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = optionalSession(req)
  if (!user) {
    sendJson(res, 200, { user: null })
    return
  }
  sendJson(res, 200, { user, usage: getUsage(user.id) })
}

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
})

export async function handleChangePassword(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const user = requireSession(req)
  rateLimit(`password:${user.id}`, 10, 60 * 60_000)
  const body = changePasswordSchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: '新密码至少 8 位' })
    return
  }
  await changePassword(user.id, body.data.oldPassword, body.data.newPassword)
  // 改密会清掉所有 session，给当前设备补一个新的
  createSession(user.id, req, res)
  sendJson(res, 200, { ok: true })
}
