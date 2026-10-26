import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getDb } from '../db'
import { HttpError } from './errors'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_SESSIONS_PER_USER = 5
// 生产默认 Secure + __Host- 前缀；本地用 HTTP 跑生产构建时可 COOKIE_SECURE=0 调试
const SECURE = process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== '0'
const COOKIE_NAME = SECURE ? '__Host-hys_session' : 'hys_session'

export interface SessionUser {
  id: string
  nickname: string
  role: 'user' | 'admin'
  mustChangePassword: boolean
}

interface SessionRow {
  id: string
  nickname: string
  role: string
  status: string
  expires_at: string
  last_seen_at: string
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function readCookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1))
  }
  return null
}

export function clientIp(req: IncomingMessage): string {
  if (process.env.TRUST_PROXY === '1') {
    // X-Real-IP 由 Nginx 用 $remote_addr 覆盖；XFF 可能被客户端伪造，取最后一跳
    const real = req.headers['x-real-ip']
    if (typeof real === 'string' && real.trim()) return real.trim()
    const xff = req.headers['x-forwarded-for']
    const raw = Array.isArray(xff) ? xff.join(',') : xff
    const last = raw?.split(',').pop()?.trim()
    if (last) return last
  }
  return req.socket.remoteAddress ?? ''
}

export function createSession(userId: string, req: IncomingMessage, res: ServerResponse): string {
  const db = getDb()
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_TTL_MS)
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString())
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    hashToken(token),
    userId,
    now.toISOString(),
    expires.toISOString(),
    now.toISOString(),
    clientIp(req).slice(0, 80),
    String(req.headers['user-agent'] ?? '').slice(0, 200),
  )
  // 只保留最近 5 个会话，防止 token 无限堆积
  db.prepare(
    `DELETE FROM sessions
     WHERE user_id = ?
       AND token_hash NOT IN (
         SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
       )`,
  ).run(userId, userId, MAX_SESSIONS_PER_USER)

  res.setHeader('Set-Cookie', cookieValue(token, SESSION_TTL_MS / 1000))
  return token
}

export function destroySession(req: IncomingMessage, res: ServerResponse): void {
  const token = readCookie(req, COOKIE_NAME)
  if (token) getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
  res.setHeader('Set-Cookie', cookieValue('', 0))
}

export function requireSession(req: IncomingMessage): SessionUser {
  const user = optionalSession(req)
  if (!user) throw new HttpError(401, '登录已过期，请重新登录')
  return user
}

export function optionalSession(req: IncomingMessage): SessionUser | null {
  const token = readCookie(req, COOKIE_NAME)
  if (!token) return null
  const row = getDb()
    .prepare(
      `SELECT u.id, u.nickname, u.role, u.status, u.must_change_password,
              s.expires_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(token)) as (SessionRow & { must_change_password?: number }) | undefined

  if (!row) return null
  if (Date.parse(row.expires_at) <= Date.now()) {
    getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
    return null
  }
  if (row.status !== 'active') {
    getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
    throw new HttpError(403, '账号已被禁用，请联系管理员')
  }
  // 每小时最多更新一次 last_seen_at，避免每个请求都写库
  if (Date.now() - Date.parse(row.last_seen_at) > 60 * 60 * 1000) {
    getDb()
      .prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
      .run(new Date().toISOString(), hashToken(token))
  }
  return {
    id: row.id,
    nickname: row.nickname,
    role: row.role === 'admin' ? 'admin' : 'user',
    mustChangePassword: Number(row.must_change_password ?? 0) === 1,
  }
}

export function sessionCookieName(): string {
  return COOKIE_NAME
}

function cookieValue(value: string, maxAgeSeconds: number): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (SECURE) parts.push('Secure')
  return parts.join('; ')
}
