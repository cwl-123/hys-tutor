import { createHash, randomInt } from 'node:crypto'
import { getDb } from '../db'

// 去掉易混字符 0/O/1/I，32 个字符 × 8 位 ≈ 40 bit 熵，配合限流足够
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LEN = 8

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase()
}

export function hashInviteCode(code: string): string {
  return createHash('sha256').update(normalizeInviteCode(code)).digest('hex')
}

export function generateInviteCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

export interface CreatedInvite {
  code: string
  expiresAt: string
}

export function createInvites(opts: {
  count: number
  createdBy?: string
  days?: number
  note?: string
}): CreatedInvite[] {
  const db = getDb()
  const days = opts.days ?? 7
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()
  const stmt = db.prepare(
    `INSERT INTO invites (code_hash, created_by, max_uses, used_count, expires_at, note, created_at)
     VALUES (?, ?, 1, 0, ?, ?, ?)`,
  )
  const out: CreatedInvite[] = []
  for (let i = 0; i < opts.count; i++) {
    const code = generateInviteCode()
    stmt.run(hashInviteCode(code), opts.createdBy ?? null, expiresAt, opts.note ?? null, now)
    out.push({ code, expiresAt })
  }
  return out
}

// 必须在事务内调用：返回 false 表示无效/过期/已用完
export function consumeInvite(code: string, now = new Date().toISOString()): boolean {
  const result = getDb()
    .prepare(
      `UPDATE invites
       SET used_count = used_count + 1
       WHERE code_hash = ? AND used_count < max_uses AND expires_at > ?`,
    )
    .run(hashInviteCode(code), now) as { changes?: number | bigint }
  return Number(result.changes ?? 0) === 1
}

export function inviteExists(code: string): boolean {
  const row = getDb()
    .prepare('SELECT used_count, max_uses, expires_at FROM invites WHERE code_hash = ?')
    .get(hashInviteCode(code)) as
    { used_count: number; max_uses: number; expires_at: string } | undefined
  return !!row && row.used_count < row.max_uses && Date.parse(row.expires_at) > Date.now()
}
