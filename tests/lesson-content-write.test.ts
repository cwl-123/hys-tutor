import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as LessonChatModule from '../server/services/lesson-chat-service'

// DATA_DIR 在 json-store 导入时绑定，必须先设 HYS_DATA_DIR 再动态导入
let svc: typeof LessonChatModule
let writeJson: typeof import('../server/repo/json-store').writeJson

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png'),
])

function lessonStub(contentMd: string) {
  return {
    id: 'l_test',
    topicId: 't_test',
    nodeIds: ['n_test'],
    scheduleReason: '测试',
    masterySnapshot: {},
    injectedReports: [],
    researchNoteIds: [],
    sources: [],
    contentMd,
    status: 'generated',
    createdAt: '2026-10-08T00:00:00.000Z',
  }
}

async function seed(contentMd: string) {
  await writeJson(path.join(process.env.HYS_DATA_DIR!, 'topics.json'), [{ id: 't_test', name: '测试' }])
  await writeJson(
    path.join(process.env.HYS_DATA_DIR!, 'topics', 't_test', 'lessons', 'l_test.json'),
    lessonStub(contentMd),
  )
}

beforeAll(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hys-content-'))
  process.env.HYS_DATA_DIR = dir
  const store = await import('../server/repo/json-store')
  writeJson = store.writeJson
  svc = await import('../server/services/lesson-chat-service')
})

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('updateLessonContent 手动写正文', () => {
  it('写入正文 + 版本快照 + 配图清单（外链图落地改写）', async () => {
    await seed('# 课\n\n## 一节\n\n原内容。')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(png), { status: 200 })),
    )
    const md = '# 课\n\n## 一节\n\n原内容。\n\n![](https://cdn.example.com/a.png)'
    const result = await svc.updateLessonContent('l_test', md, '插入图片')

    // 外链落地为本地素材引用
    expect(result.contentMd).not.toContain('cdn.example.com')
    expect(result.contentMd).toMatch(/!\[\]\(\/api\/topics\/t_test\/assets\/[0-9a-f]{16}\.png\)/)
    expect(result.images).toHaveLength(1)
    expect(result.images[0].originUrl).toBe('https://cdn.example.com/a.png')

    // 落盘 + 版本快照
    const { readJson } = await import('../server/repo/json-store')
    const saved = await readJson<{ contentMd: string; images: unknown[] }>(
      path.join(process.env.HYS_DATA_DIR!, 'topics', 't_test', 'lessons', 'l_test.json'),
      { contentMd: '', images: [] },
    )
    expect(saved.contentMd).toBe(result.contentMd)
    expect(saved.images).toHaveLength(1)
    const versions = await readJson<{ summary: string }[]>(
      path.join(process.env.HYS_DATA_DIR!, 'topics', 't_test', 'lesson-versions', 'l_test.json'),
      [],
    )
    expect(versions).toHaveLength(1)
    expect(versions[0].summary).toContain('插入图片')
  })

  it('生成中的课件拒绝手动编辑', async () => {
    await seed('# 课')
    const stub = lessonStub('# 课')
    stub.status = 'writing'
    await writeJson(
      path.join(process.env.HYS_DATA_DIR!, 'topics', 't_test', 'lessons', 'l_test.json'),
      stub,
    )
    await expect(svc.updateLessonContent('l_test', '# 新', '')).rejects.toThrow(/尚未生成完成/)
  })

  it('undo 可撤销手动修改', async () => {
    await seed('# 课\n\n## 一节\n\n旧内容。')
    await svc.updateLessonContent('l_test', '# 课\n\n## 一节\n\n新内容。', '改一节')
    const undone = await svc.undoLessonChat('l_test')
    expect(undone.contentMd).toContain('旧内容。')
    expect(undone.contentMd).not.toContain('新内容。')
  })
})
