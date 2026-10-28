import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// json-store 在模块加载时读取 HYS_DATA_DIR，必须在动态 import 之前设置
const dataDir = await mkdtemp(path.join(tmpdir(), 'hys-onboarding-'))
process.env.HYS_DATA_DIR = dataDir

vi.mock('../server/llm/client', () => ({
  completeJson: vi.fn(),
  getLLMModel: () => 'test-model',
}))

const { completeJson } = await import('../server/llm/client')
const { chatOnboarding, ONBOARDING_MAX_TURNS } = await import(
  '../server/services/onboarding-service'
)
const { saveOnboardingAttachment } = await import('../server/services/onboarding-attachments')
const { runAsUser } = await import('../server/repo/context')

const mockJson = vi.mocked(completeJson)

beforeEach(() => {
  mockJson.mockReset()
})

describe('chatOnboarding', () => {
  it('信息不足时透传提问与快捷回复', async () => {
    mockJson.mockResolvedValue({
      reply: '你说的深入概念主要指哪类？',
      quickReplies: ['财务指标', '商业模式', '估值方法'],
    })

    const r = await chatOnboarding([{ role: 'user', content: '我想学怎么看一家公司' }])
    expect(r.reply).toContain('哪类')
    expect(r.quickReplies).toEqual(['财务指标', '商业模式', '估值方法'])
    expect(r.proposal).toBeUndefined()
  })

  it('给出提案时把已掌握内容拼进 profile.extra，快捷回复清空', async () => {
    mockJson.mockResolvedValue({
      reply: '我帮你整理好了',
      quickReplies: [],
      proposal: {
        name: ' 价值投资：公司基本面分析 ',
        scope: '财务报表 → 盈利能力 → 护城河 → 估值',
        style: '案例驱动',
        level: '有一定基础',
        extra: '多结合真实公司案例',
        knownTopics: ['PE', ' PB ', '股息率'],
      },
    })

    const r = await chatOnboarding([
      { role: 'user', content: '我想学怎么看一家公司' },
      { role: 'assistant', content: '你目前对哪些指标比较熟？' },
      { role: 'user', content: 'PE、PB、股息率我比较熟，ROE 不懂' },
    ])
    expect(r.quickReplies).toEqual([])
    expect(r.proposal?.name).toBe('价值投资：公司基本面分析')
    expect(r.proposal?.profile.style).toBe('案例驱动')
    expect(r.proposal?.profile.level).toBe('有一定基础')
    expect(r.proposal?.profile.extra).toBe('已熟悉：PE、PB、股息率，相关基础可简要带过；多结合真实公司案例')
  })

  it('提案无额外信息时 profile 为空对象', async () => {
    mockJson.mockResolvedValue({
      reply: '整理好了',
      quickReplies: [],
      proposal: { name: '期权定价', scope: '…', knownTopics: [] },
    })

    const r = await chatOnboarding([{ role: 'user', content: '学期权' }])
    expect(r.proposal?.profile).toEqual({})
  })

  it('达到轮次上限时 prompt 强制要求输出提案', async () => {
    mockJson.mockResolvedValue({ reply: '收敛一下', quickReplies: [] })

    const messages = Array.from({ length: ONBOARDING_MAX_TURNS }, (_, i) => ({
      role: 'user' as const,
      content: `第 ${i + 1} 轮`,
    }))
    await chatOnboarding(messages)

    const prompt = mockJson.mock.calls[0][0].prompt
    expect(prompt).toContain('本轮必须')
  })

  it('文本附件正文注入 prompt，文件名进历史', async () => {
    mockJson.mockResolvedValue({ reply: '看到你的大纲了', quickReplies: [] })
    const meta = await runAsUser('local', () =>
      saveOnboardingAttachment({
        name: '课程大纲.txt',
        buf: Buffer.from('第 1 章 财务分析\n第 2 章 估值方法'),
      }),
    )

    await chatOnboarding([
      {
        role: 'user',
        content: '照着这个大纲学',
        attachments: [{ id: meta.id, name: meta.name, kind: 'text' }],
      },
    ])

    const opts = mockJson.mock.calls[0][0]
    expect(opts.prompt).toContain('课程大纲.txt')
    expect(opts.prompt).toContain('第 2 章 估值方法')
    expect(opts.imageDataUrls).toEqual([])
  })

  it('图片附件以 data URL 走多模态，不再重复注入正文', async () => {
    mockJson.mockResolvedValue({ reply: '图里是财报', quickReplies: [] })
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('fake'),
    ])
    const meta = await runAsUser('local', () =>
      saveOnboardingAttachment({ name: '财报截图.png', buf: png }),
    )

    await chatOnboarding([
      {
        role: 'user',
        content: '',
        attachments: [{ id: meta.id, name: meta.name, kind: 'image' }],
      },
    ])

    const opts = mockJson.mock.calls[0][0]
    const urls = opts.imageDataUrls ?? []
    expect(urls).toHaveLength(1)
    expect(urls[0]).toMatch(/^data:image\/png;base64,/)
    expect(opts.prompt).toContain('只上传了附件')
    expect(opts.prompt).toContain('直接查看图片')
  })

  it('附件已被清理时提示模型让用户重传，不抛出', async () => {
    mockJson.mockResolvedValue({ reply: '附件过期了', quickReplies: [] })

    await chatOnboarding([
      {
        role: 'user',
        content: '看看这份',
        attachments: [{ id: 'att_deadbeef', name: '旧文件.pdf', kind: 'text' }],
      },
    ])

    const opts = mockJson.mock.calls[0][0]
    expect(opts.prompt).toContain('已过期')
    expect(opts.imageDataUrls).toEqual([])
  })
})
