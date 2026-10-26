import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'

const dataDir = await mkdtemp(path.join(tmpdir(), 'hys-feedback-'))
process.env.HYS_DATA_DIR = dataDir
process.env.HYS_DB_PATH = path.join(dataDir, 'control.db')
process.env.HYS_DEV_NO_AUTH = '1'
process.env.NODE_ENV = 'test'

const { closeDbForTests } = await import('../server/db')
const { handleCreateFeedback } = await import('../server/routes/feedback')
const { handleAdminFeedback } = await import('../server/routes/admin')

function fakeRes(): ServerResponse & { body: string; statusCode: number } {
  const out = {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(chunk?: string) {
      out.body = chunk ?? ''
    },
  }
  return out as unknown as ServerResponse & { body: string; statusCode: number }
}

function fakeReq(body: unknown): IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage
}

afterAll(() => closeDbForTests())

describe('反馈', () => {
  it('登录用户提交后管理员可看到', async () => {
    const created = fakeRes()
    await handleCreateFeedback(
      fakeReq({ kind: 'bug', body: '课程页公式渲染错位', page: '/lesson/x' }),
      created,
    )
    expect(created.statusCode).toBe(200)
    expect(created.body).toMatch(/"ok":true/)

    const listed = fakeRes()
    await handleAdminFeedback(fakeReq({}), listed)
    expect(listed.statusCode).toBe(200)
    const data = JSON.parse(listed.body) as { feedback: { body: string; nickname: string }[] }
    expect(data.feedback[0]?.body).toBe('课程页公式渲染错位')
    expect(data.feedback[0]?.nickname).toBe('本地用户')
  })

  it('拒绝过短内容', async () => {
    const res = fakeRes()
    await handleCreateFeedback(fakeReq({ body: 'x' }), res)
    expect(res.statusCode).toBe(400)
  })
})
