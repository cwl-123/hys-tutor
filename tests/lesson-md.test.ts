import { describe, expect, it } from 'vitest'
import {
  findSectionByHeading,
  findSectionForQuote,
  listHeadings,
  parseSections,
  replaceSection,
} from '../shared/lesson-md'

const md = `# 双塔召回

开头引入段落。

## 为什么需要双塔
双塔把用户和物品分开编码 [1]。

## 结构详解
用户塔与物品塔各自过 MLP。

\`\`\`python
# 下面是代码里的伪标题
## 这不是章节
print("hi")
\`\`\`

## 本课小结
记住两个塔独立编码。`

describe('parseSections', () => {
  it('拆出前言 + 各二级章节', () => {
    const sections = parseSections(md)
    expect(sections.map((s) => s.heading)).toEqual([
      null,
      '为什么需要双塔',
      '结构详解',
      '本课小结',
    ])
  })

  it('忽略代码围栏内的伪标题', () => {
    expect(listHeadings(md)).not.toContain('这不是章节')
  })

  it('章节 raw 可直接拼接还原正文', () => {
    const sections = parseSections(md)
    expect(sections.map((s) => s.raw).join('\n')).toBe(md)
  })
})

describe('replaceSection', () => {
  it('只替换目标章节，其他章节原样保留', () => {
    const next = replaceSection(md, '结构详解', '## 结构详解\n改写后的内容。')
    expect(next).not.toBeNull()
    expect(next).toContain('改写后的内容。')
    expect(next).toContain('双塔把用户和物品分开编码 [1]。')
    expect(next).toContain('## 本课小结')
    expect(next).not.toContain('用户塔与物品塔各自过 MLP')
    // 未破坏章节数量
    expect(listHeadings(next!)).toHaveLength(3)
  })

  it('标题不存在时返回 null', () => {
    expect(replaceSection(md, '不存在的章节', '## x')).toBeNull()
  })

  it('支持按包含关系兜底匹配标题', () => {
    const next = replaceSection(md, '结构', '## 结构详解\n新内容。')
    expect(next).toContain('新内容。')
  })
})

describe('findSectionByHeading', () => {
  it('精确定位', () => {
    expect(findSectionByHeading(md, '本课小结')?.heading).toBe('本课小结')
  })
})

describe('findSectionForQuote', () => {
  it('按选中文字定位所属章节', () => {
    expect(findSectionForQuote(md, '用户塔与物品塔各自过 MLP')).toBe('结构详解')
  })

  it('引文不存在时返回 null 或最近章节标题', () => {
    const r = findSectionForQuote(md, '双塔把用户和物品分开编码')
    expect(r).toBe('为什么需要双塔')
  })
})