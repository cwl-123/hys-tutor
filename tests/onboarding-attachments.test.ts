import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// DATA_DIR 在模块加载时绑定，必须先设 HYS_DATA_DIR 再动态 import
const dataDir = await mkdtemp(path.join(tmpdir(), 'hys-onboarding-attachments-'))
process.env.HYS_DATA_DIR = dataDir

const attachments = await import('../server/services/onboarding-attachments')
const { runAsUser } = await import('../server/repo/context')

function png(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('some-png-bytes'),
  ])
}

describe('saveOnboardingAttachment', () => {
  it('图片保留原文件并返回可预览地址', async () => {
    const meta = await runAsUser('alice', () =>
      attachments.saveOnboardingAttachment({ name: 'screenshot.png', buf: png() }),
    )
    expect(meta.kind).toBe('image')
    expect(meta.url).toBe(`/api/onboarding/attachments/${meta.id}`)
    expect(meta.mime).toBe('image/png')

    const image = await runAsUser('alice', () => attachments.readOnboardingAttachmentImage(meta.id))
    expect(image?.mime).toBe('image/png')
    expect(image?.buf.equals(png())).toBe(true)
  })

  it('文本文件只保留抽取后的正文与预览', async () => {
    const meta = await runAsUser('alice', () =>
      attachments.saveOnboardingAttachment({
        name: '大纲.txt',
        buf: Buffer.from('第一章 财务分析\n第二章 估值方法'),
      }),
    )
    expect(meta.kind).toBe('text')
    expect(meta.format).toBe('text')
    expect(meta.chars).toBeGreaterThan(0)
    expect(meta.preview).toContain('第一章')

    const loaded = await runAsUser('alice', () =>
      attachments.loadOnboardingAttachments([{ id: meta.id, name: meta.name, kind: 'text' }]),
    )
    expect(loaded[0]?.text).toContain('第二章 估值方法')
  })

  it('不支持的文件给出可执行提示', async () => {
    await expect(
      runAsUser('alice', () =>
        attachments.saveOnboardingAttachment({
          name: 'data.xlsx',
          buf: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]),
        }),
      ),
    ).rejects.toThrow(/暂不支持/)
  })

  it('附件按用户隔离，伪造/过期的 id 直接跳过', async () => {
    const meta = await runAsUser('alice', () =>
      attachments.saveOnboardingAttachment({ name: 'a.txt', buf: Buffer.from('私人资料') }),
    )
    const bobSees = await runAsUser('bob', () =>
      attachments.loadOnboardingAttachments([
        { id: meta.id, name: 'a.txt', kind: 'text' },
        { id: 'att_deadbeef', name: 'gone.txt', kind: 'text' },
      ]),
    )
    expect(bobSees).toHaveLength(0)
  })

  it('删除后不可再读', async () => {
    const meta = await runAsUser('alice', () =>
      attachments.saveOnboardingAttachment({ name: 'b.txt', buf: Buffer.from('待删除') }),
    )
    await runAsUser('alice', () => attachments.deleteOnboardingAttachment(meta.id))
    const loaded = await runAsUser('alice', () => attachments.readOnboardingAttachment(meta.id))
    expect(loaded).toBeNull()
  })
})

describe('sanitizeFileName', () => {
  it('去掉路径与控制字符，保留可读文件名', () => {
    expect(attachments.sanitizeFileName('../../etc/passwd')).toBe('passwd')
    expect(attachments.sanitizeFileName('a\u0000b/课程\n大纲.pdf')).toBe('课程大纲.pdf')
    expect(attachments.sanitizeFileName('')).toBe('未命名文件')
  })
})
