import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { ensureUserDir } from '../repo/json-store'
import { HttpError } from './errors'
import { hashPassword, validatePassword, verifyPassword } from './password'
import { consumeInvite, normalizeInviteCode } from './invite'

export type Role = 'user' | 'admin'

export interface AuthUser {
  id: string
  nickname: string
  role: Role
  mustChangePassword: boolean
}

interface UserRow {
  id: string
  nickname: string
  password_hash: string
  role: string
  status: string
  must_change_password: number
  created_at: string
  last_login_at: string | null
}

const NICKNAME_RE = /^[\p{L}\p{N}_-]{2,20}$/u

export function validateNickname(nickname: string): string | null {
  if (!NICKNAME_RE.test(nickname)) return '昵称需为 2~20 位中文、字母、数字、下划线或中划线'
  return null
}

export interface RegisterInput {
  inviteCode: string
  nickname: string
  password: string
  acceptedTerms: boolean
}

export async function registerUser(input: RegisterInput): Promise<AuthUser> {
  const nickname = input.nickname.trim()
  const badName = validateNickname(nickname)
  if (badName) throw new HttpError(400, badName)
  const badPassword = validatePassword(input.password)
  if (badPassword) throw new HttpError(400, badPassword)
  if (!input.acceptedTerms) throw new HttpError(400, '请先同意用户协议与隐私政策')

  const maxUsers = Number(process.env.MAX_USERS || 50)
  const db = getDb()

  // 哈希在事务外做：scrypt 是异步的，不能把事务挂在 await 上
  const passwordHash = await hashPassword(input.password)

  db.exec('BEGIN IMMEDIATE')
  let userId = ''
  let isFirstUser = false
  try {
    // 计数放在 BEGIN IMMEDIATE 后：避免并发注册都看到 0 而同时成为管理员
    const before = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
    if (Number(before.n) >= maxUsers) throw new HttpError(403, '内测名额已满，请联系管理员')
    isFirstUser = Number(before.n) === 0
    const existing = db
      .prepare('SELECT id FROM users WHERE nickname = ? COLLATE NOCASE')
      .get(nickname) as { id: string } | undefined
    if (existing) throw new HttpError(409, '该昵称已被使用，换一个吧')
    // 冷启动：第一个用户可用 BOOTSTRAP_INVITE_CODE 注册，避免「没管理员就发不了邀请码」死锁
    const bootstrap = process.env.BOOTSTRAP_INVITE_CODE?.trim().toUpperCase()
    const viaBootstrap =
      isFirstUser && !!bootstrap && normalizeInviteCode(input.inviteCode) === bootstrap
    if (!viaBootstrap && !consumeInvite(input.inviteCode)) {
      throw new HttpError(400, '邀请码无效、已用完或已过期')
    }
    userId = `u_${randomUUID().replace(/-/g, '').slice(0, 8)}`
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO users (id, nickname, password_hash, role, status, created_at, terms_accepted_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    ).run(userId, nickname, passwordHash, isFirstUser ? 'admin' : 'user', now, now)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  await ensureUserDir(userId)
  return { id: userId, nickname, role: isFirstUser ? 'admin' : 'user', mustChangePassword: false }
}

export async function loginUser(nicknameInput: string, password: string): Promise<AuthUser> {
  const nickname = nicknameInput.trim()
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, nickname, password_hash, role, status, must_change_password,
              created_at, last_login_at
       FROM users WHERE nickname = ? COLLATE NOCASE`,
    )
    .get(nickname) as UserRow | undefined

  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw new HttpError(401, '昵称或密码错误')
  }
  if (row.status !== 'active') throw new HttpError(403, '账号已被禁用，请联系管理员')
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    row.id,
  )
  return {
    id: row.id,
    nickname: row.nickname,
    role: row.role === 'admin' ? 'admin' : 'user',
    mustChangePassword: Number(row.must_change_password) === 1,
  }
}

export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  const bad = validatePassword(newPassword)
  if (bad) throw new HttpError(400, bad)
  const db = getDb()
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
    { password_hash: string } | undefined
  if (!row) throw new HttpError(401, '用户不存在')
  if (!(await verifyPassword(oldPassword, row.password_hash))) {
    throw new HttpError(400, '旧密码不正确')
  }
  const hash = await hashPassword(newPassword)
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
    hash,
    userId,
  )
  // 改密后踢掉其他设备，路由层会为当前设备重新发 session
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export async function resetPasswordByAdmin(userId: string, tempPassword: string): Promise<void> {
  const bad = validatePassword(tempPassword)
  if (bad) throw new HttpError(400, bad)
  const hash = await hashPassword(tempPassword)
  const db = getDb()
  const result = db
    .prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
    .run(hash, userId) as { changes?: number | bigint }
  if (Number(result.changes ?? 0) !== 1) throw new HttpError(404, '用户不存在')
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export function getUserById(userId: string): AuthUser | null {
  const row = getDb()
    .prepare(`SELECT id, nickname, role, must_change_password FROM users WHERE id = ?`)
    .get(userId) as
    { id: string; nickname: string; role: string; must_change_password: number } | undefined
  if (!row) return null
  return {
    id: row.id,
    nickname: row.nickname,
    role: row.role === 'admin' ? 'admin' : 'user',
    mustChangePassword: Number(row.must_change_password) === 1,
  }
}

export interface AdminUserRow {
  id: string
  nickname: string
  role: string
  status: string
  createdAt: string
  lastLoginAt: string | null
}

export function listUsers(): AdminUserRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, nickname, role, status, created_at, last_login_at
       FROM users ORDER BY created_at DESC`,
    )
    .all() as Array<{
    id: string
    nickname: string
    role: string
    status: string
    created_at: string
    last_login_at: string | null
  }>
  return rows.map((r) => ({
    id: r.id,
    nickname: r.nickname,
    role: r.role,
    status: r.status,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  }))
}

export function setUserStatus(userId: string, status: 'active' | 'disabled'): void {
  const result = getDb()
    .prepare('UPDATE users SET status = ? WHERE id = ?')
    .run(status, userId) as { changes?: number | bigint }
  if (Number(result.changes ?? 0) !== 1) throw new HttpError(404, '用户不存在')
  if (status === 'disabled') getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}
