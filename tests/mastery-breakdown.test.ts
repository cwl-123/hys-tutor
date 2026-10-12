import { describe, expect, it } from 'vitest'
import { masteryBreakdown } from '../shared/mastery'

describe('masteryBreakdown 掌握度分档（首页卡片三段进度条）', () => {
  it('空图谱全部为 0', () => {
    expect(masteryBreakdown([])).toEqual({ mastered: 0, learning: 0, weak: 0, untouched: 0 })
  })

  it('按 红 <40 / 黄 40-79 / 绿 ≥80 分档，0 分单列为未开始', () => {
    expect(masteryBreakdown([0, 0, 1, 39, 40, 79, 80, 100])).toEqual({
      mastered: 2,
      learning: 2,
      weak: 2,
      untouched: 2,
    })
  })

  it('四档之和等于知识点总数', () => {
    const scores = [0, 12, 55, 90, 0, 80, 41]
    const b = masteryBreakdown(scores)
    expect(b.mastered + b.learning + b.weak + b.untouched).toBe(scores.length)
  })
})
