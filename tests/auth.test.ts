import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const dataDir = await mkdtemp(path.join(tmpdir(), 'hys-auth-'))
process.env.HYS_DATA_DIR = dataDir
process.env.HYS_DB_PATH = path.join(dataDir, 'control.db')
process.env.APP_ORIGIN = 'http://localhost:5173'

const { getDb, closeDbForTests } = await import('../server/db')
const { createInvites } = await import('../server/auth/invite')
const { registerUser, loginUser, changePassword } = await import('../server/auth/service')
const { createSession, requireSession } = await import('../server/auth/session')
const { dataPath } = await import('../server/repo/json-store')
const { assertQuota, recordAction, getUsage } = await import('../server/services/quota-service')
const { runAsUser } = await import('../server/repo/context')

function resetDb(): void {
  const db = getDb()
  db.exec('DELETE FROM usage_events; DELETE FROM sessions; DELETE FROM invites;')
  // 测试环境启动时会 seed local 用户；清掉，才能验证「首个注册用户是管理员」
  db.exec('DELETE FROM users;')
}

function fakeRes(): ServerResponse & { headers: Record<string, string> } {
  const headers: Record<string, string> = {}
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value
    },
  } as unknown as ServerResponse & { headers: Record<string, string> }
}

function fakeReq(cookie?: string): IncomingMessage {
  return {
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage
}

function cookieFrom(res: ServerResponse & { headers: Record<string, string> }): string {
  const raw = res.headers['set-cookie'] ?? ''
  return raw.split(';')[0] ?? ''
}

beforeEach(resetDb)

afterAll(() => closeDbForTests())

describe('邀请码注册', () => {
  it('首个用户成为管理员，邀请码只能用一次', async () => {
    const [invite] = createInvites({ count: 1 })
    const user = await registerUser({
      inviteCode: invite.code,
      nickname: '测试用户',
      password: 'password123',
      acceptedTerms: true,
    })
    expect(user.nickname).toBe('测试用户')
    expect(user.role).toBe('admin')

    await expect(
      registerUser({
        inviteCode: invite.code,
        nickname: '第二个人',
        password: 'password123',
        acceptedTerms: true,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('昵称大小写不敏感去重', async () => {
    const [a, b] = createInvites({ count: 2 })
    await registerUser({
      inviteCode: a.code,
      nickname: 'Alice',
      password: 'password123',
      acceptedTerms: true,
    })
    await expect(
      registerUser({
        inviteCode: b.code,
        nickname: 'alice',
        password: 'password123',
        acceptedTerms: true,
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('未同意协议/弱密码/无效邀请码被拒绝', async () => {
    const [invite] = createInvites({ count: 1 })
    await expect(
      registerUser({
        inviteCode: invite.code,
        nickname: '张三',
        password: 'password123',
        acceptedTerms: false,
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      registerUser({
        inviteCode: invite.code,
        nickname: '张三',
        password: '123',
        acceptedTerms: true,
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      registerUser({
        inviteCode: 'BADCODE1',
        nickname: '张三',
        password: 'password123',
        acceptedTerms: true,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('登录与会话', () => {
  it('密码校验、会话恢复、改密踢掉旧会话', async () => {
    const [invite] = createInvites({ count: 1 })
    const registered = await registerUser({
      inviteCode: invite.code,
      nickname: '学习者',
      password: 'password123',
      acceptedTerms: true,
    })

    await expect(loginUser('学习者', 'wrong-pass')).rejects.toMatchObject({ status: 401 })
    const logged = await loginUser('学习者', 'password123')
    expect(logged.id).toBe(registered.id)

    const res = fakeRes()
    createSession(logged.id, fakeReq(), res)
    const cookie = cookieFrom(res)
    expect(cookie).toContain('hys_session=')
    const me = requireSession(fakeReq(cookie))
    expect(me.nickname).toBe('学习者')

    await changePassword(logged.id, 'password123', 'newpassword456')
    await expect(loginUser('学习者', 'password123')).rejects.toMatchObject({ status: 401 })
    await expect(loginUser('学习者', 'newpassword456')).resolves.toMatchObject({ id: logged.id })
  })

  it('禁用用户不能登录', async () => {
    const [invite] = createInvites({ count: 1 })
    const user = await registerUser({
      inviteCode: invite.code,
      nickname: '待禁用',
      password: 'password123',
      acceptedTerms: true,
    })
    getDb().prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(user.id)
    await expect(loginUser('待禁用', 'password123')).rejects.toMatchObject({ status: 403 })
  })
})

describe('每日配额', () => {
  it('达到上限后拒绝并记录用量', async () => {
    process.env.QUOTA_TOPICS_PER_DAY = '1'
    const [invite] = createInvites({ count: 1 })
    const user = await registerUser({
      inviteCode: invite.code,
      nickname: '配额用户',
      password: 'password123',
      acceptedTerms: true,
    })
    runAsUser(user.id, () => {
      assertQuota(user.id, 'topic')
      recordAction(user.id, 'topic')
      expect(getUsage(user.id).actions.topic.used).toBe(1)
      expect(() => assertQuota(user.id, 'topic')).toThrowError(/上限/)
    })
    delete process.env.QUOTA_TOPICS_PER_DAY
  })
})

describe('用户数据目录隔离', () => {
  it('dataPath 按 ALS 用户分目录', () => {
    const a = runAsUser('u_aaa', () => dataPath('topics.json'))
    const b = runAsUser('u_bbb', () => dataPath('topics.json'))
    expect(a).toContain(`${path.sep}users${path.sep}u_aaa${path.sep}`)
    expect(b).toContain(`${path.sep}users${path.sep}u_bbb${path.sep}`)
    expect(a).not.toBe(b)
  })
})
