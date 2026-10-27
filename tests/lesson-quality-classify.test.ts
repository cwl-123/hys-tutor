import { describe, expect, it } from 'vitest'
import { isFactualIssue } from '../server/services/lesson-agent'

describe('质检 issue 分类', () => {
  it('图片 URL / 引用越界 / 排版问题交给后处理，不触发重写', () => {
    expect(isFactualIssue('第 2 节配图 URL 指向来源页而不是图片直链')).toBe(false)
    expect(isFactualIssue('引用 [4] 越界，来源只有 3 条')).toBe(false)
    expect(isFactualIssue('标题层级格式不统一')).toBe(false)
    expect(isFactualIssue('markdown 表格排版错乱')).toBe(false)
  })

  it('与笔记矛盾 / 编造事实才允许重写一次', () => {
    expect(isFactualIssue('第 3 节「Wide 支路只做泛化」与笔记矛盾')).toBe(true)
    expect(isFactualIssue('文中编造了 2024 年的实验数据，笔记中没有该数据')).toBe(true)
    expect(isFactualIssue('关键结论缺乏依据，与研究笔记无法对应')).toBe(true)
  })
})