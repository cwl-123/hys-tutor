import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// json-store 在模块加载时读取 HYS_DATA_DIR，必须在动态 import 之前设置
const dataDir = await mkdtemp(path.join(tmpdir(), 'hys-pref-'))
process.env.HYS_DATA_DIR = dataDir

const completeJson = vi.fn()
vi.mock('../server/llm/client', () => ({
  completeJson: (...args: unknown[]) => completeJson(...args),
}))

const {
  addPreference,
  extractPreferences,
  listPreferences,
  preferenceContextText,
  removePreference,
  safeExtractPreferences,
  updatePreference,
} = await import('../server/services/preference-service')
const { writeJson } = await import('../server/repo/json-store')

const SOURCE = { kind: 'lesson-chat' as const, label: '测试来源' }

beforeEach(async () => {
  completeJson.mockReset()
  await writeJson(path.join(dataDir, 'preferences.json'), [])
})

describe('偏好 CRUD', () => {
  it('新增/列表/编辑/删除', async () => {
    const p = await addPreference(' 讲新概念先举生活例子 ', { kind: 'manual' })
    expect(p.text).toBe('讲新概念先举生活例子')
    expect(p.source.kind).toBe('manual')

    const updated = await updatePreference(p.id, '先举例子再上公式')
    expect(updated?.text).toBe('先举例子再上公式')

    expect((await listPreferences()).map((x) => x.text)).toEqual(['先举例子再上公式'])

    expect(await removePreference(p.id)).toBe(true)
    expect(await removePreference(p.id)).toBe(false)
    expect(await listPreferences()).toEqual([])
  })

  it('preferenceContextText：空清单返回空串，有偏好时逐条列出', async () => {
    expect(await preferenceContextText()).toBe('')
    await addPreference('少堆术语', { kind: 'manual' })
    const text = await preferenceContextText()
    expect(text).toContain('学习者长期偏好')
    expect(text).toContain('- 少堆术语')
  })
})

describe('extractPreferences', () => {
  it('add：新偏好入库并返回', async () => {
    completeJson.mockResolvedValue({ ops: [{ action: 'add', text: '多给工程案例' }] })
    const changed = await extractPreferences('以后多给点工程案例', SOURCE)
    expect(changed).toHaveLength(1)
    const prefs = await listPreferences()
    expect(prefs.map((p) => p.text)).toEqual(['多给工程案例'])
    expect(prefs[0].source).toEqual(SOURCE)
  })

  it('空交互直接跳过，不调 LLM', async () => {
    expect(await extractPreferences('   ', SOURCE)).toEqual([])
    expect(completeJson).not.toHaveBeenCalled()
  })

  it('完全同文不重复入库（服务端兜底去重）', async () => {
    await addPreference('通俗一点', { kind: 'manual' })
    completeJson.mockResolvedValue({ ops: [{ action: 'add', text: '通俗一点' }] })
    const changed = await extractPreferences('讲得太复杂了，通俗点', SOURCE)
    expect(changed).toEqual([])
    expect(await listPreferences()).toHaveLength(1)
  })

  it('merge：合并进既有条目，不新增', async () => {
    const old = await addPreference('通俗一点', { kind: 'manual' })
    completeJson.mockResolvedValue({
      ops: [{ action: 'merge', targetId: old.id, text: '讲解尽量通俗，先直觉后公式' }],
    })
    const changed = await extractPreferences('讲得太复杂', SOURCE)
    expect(changed).toHaveLength(1)
    const prefs = await listPreferences()
    expect(prefs).toHaveLength(1)
    expect(prefs[0].text).toBe('讲解尽量通俗，先直觉后公式')
  })

  it('merge 的 targetId 无效时降级为 add', async () => {
    completeJson.mockResolvedValue({
      ops: [{ action: 'merge', targetId: 'p_不存在', text: '多画图少堆字' }],
    })
    await extractPreferences('以后多画图', SOURCE)
    const prefs = await listPreferences()
    expect(prefs.map((p) => p.text)).toEqual(['多画图少堆字'])
  })

  it('满 50 条时不再 add', async () => {
    const prefs = Array.from({ length: 50 }, (_, i) => ({
      id: `p_${i}`,
      text: `偏好${i}`,
      source: { kind: 'manual' as const },
      createdAt: new Date().toISOString(),
    }))
    await writeJson(path.join(dataDir, 'preferences.json'), prefs)
    completeJson.mockResolvedValue({ ops: [{ action: 'add', text: '新偏好' }] })
    const changed = await extractPreferences('再来一条', SOURCE)
    expect(changed).toEqual([])
    expect(await listPreferences()).toHaveLength(50)
  })
})

describe('safeExtractPreferences', () => {
  it('LLM 失败静默降级为空，不抛出', async () => {
    completeJson.mockRejectedValue(new Error('LLM 挂了'))
    await expect(safeExtractPreferences('通俗点', SOURCE)).resolves.toEqual([])
  })
})
