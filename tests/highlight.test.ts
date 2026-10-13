import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'

// json-store 在模块加载时读取 HYS_DATA_DIR，必须先设置再动态 import
const dataDir = await mkdtemp(path.join(tmpdir(), 'hys-highlight-'))
process.env.HYS_DATA_DIR = dataDir

const { addHighlight, listHighlights, removeHighlight } = await import(
  '../server/services/highlight-service'
)
const { applyHighlights, computeOccurrence, unwrapHighlights } = await import(
  '../src/utils/highlight-dom'
)

describe('highlight-service', () => {
  it('新增 / 列出 / 删除划线', async () => {
    const h = await addHighlight('t_hl', 'l_1', {
      heading: '梯度下降',
      text: '学习率决定步长',
      occurrence: 0,
    })
    expect(h.id).toBeTruthy()
    expect(h.heading).toBe('梯度下降')

    const list = await listHighlights('t_hl', 'l_1')
    expect(list).toHaveLength(1)
    expect(list[0].text).toBe('学习率决定步长')

    await expect(removeHighlight('t_hl', 'l_1', h.id)).resolves.toBe(true)
    await expect(listHighlights('t_hl', 'l_1')).resolves.toEqual([])
  })

  it('同一锚点重复划线复用，不重复落盘', async () => {
    const input = { heading: null, text: '重点句', occurrence: 0 }
    const a = await addHighlight('t_hl', 'l_2', input)
    const b = await addHighlight('t_hl', 'l_2', input)
    expect(b.id).toBe(a.id)
    await expect(listHighlights('t_hl', 'l_2')).resolves.toHaveLength(1)
  })

  it('并发划线不丢记录（withLock 串行化）', async () => {
    await Promise.all([
      addHighlight('t_hl', 'l_3', { heading: 'A', text: 'x', occurrence: 0 }),
      addHighlight('t_hl', 'l_3', { heading: 'B', text: 'y', occurrence: 0 }),
      addHighlight('t_hl', 'l_3', { heading: 'C', text: 'z', occurrence: 0 }),
    ])
    await expect(listHighlights('t_hl', 'l_3')).resolves.toHaveLength(3)
  })
})

describe('highlight-dom', () => {
  beforeAll(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
    const g = globalThis as Record<string, unknown>
    g.window = dom.window
    g.document = dom.window.document
    g.Node = dom.window.Node
    g.NodeFilter = dom.window.NodeFilter
    g.HTMLElement = dom.window.HTMLElement
    g.Range = dom.window.Range
  })

  function makeRoot(html: string): HTMLElement {
    const root = document.createElement('div')
    root.innerHTML = html
    return root
  }

  it('applyHighlights 用 <mark> 包裹指定出现次序的文字', () => {
    const root = makeRoot('<p>重复重复</p><p>唯一句子</p>')
    applyHighlights(root, [
      { id: 'hl_1', text: '重复', occurrence: 1 },
      { id: 'hl_2', text: '唯一句子', occurrence: 0 },
    ])
    const marks = root.querySelectorAll('mark.lesson-hl')
    expect(marks).toHaveLength(2)
    expect(marks[0].getAttribute('data-hl-id')).toBe('hl_1')
    expect(marks[0].textContent).toBe('重复')
    expect(marks[1].textContent).toBe('唯一句子')
    // 第一个「重复」不应被包进 mark：第一个 <p> 的第一个文本节点保留
    expect(root.querySelector('p')?.firstChild?.nodeType).toBe(3)
  })

  it('unwrapHighlights 还原为纯文本', () => {
    const root = makeRoot('<p>可还原的划线文字</p>')
    applyHighlights(root, [{ id: 'hl_x', text: '划线文字', occurrence: 0 }])
    expect(root.querySelectorAll('mark.lesson-hl')).toHaveLength(1)
    unwrapHighlights(root)
    expect(root.querySelectorAll('mark.lesson-hl')).toHaveLength(0)
    expect(root.textContent).toBe('可还原的划线文字')
  })

  it('找不到锚点文字时不报错、不产生 mark', () => {
    const root = makeRoot('<p>正文</p>')
    applyHighlights(root, [{ id: 'hl_g', text: '不存在的句子', occurrence: 0 }])
    expect(root.querySelectorAll('mark.lesson-hl')).toHaveLength(0)
  })

  it('computeOccurrence 返回选区起点前的出现次数', () => {
    const root = makeRoot('<p>abc abc abc</p>')
    const textNode = root.querySelector('p')!.firstChild as Text
    // 起点在第二个 abc 之前（offset 4）
    expect(computeOccurrence(root, textNode, 4, 'abc')).toBe(1)
    expect(computeOccurrence(root, textNode, 0, 'abc')).toBe(0)
  })
})