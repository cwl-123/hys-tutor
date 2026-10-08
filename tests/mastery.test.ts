import { describe, expect, it } from 'vitest'
import { clampMastery, masteryDelta } from '../shared/mastery'
import { gradeObjective, normalizeObjectiveAnswer } from '../server/services/grading-service'
import type { Question } from '../shared/types'

function q(partial: Partial<Question>): Question {
  return { id: 'q_1', nodeId: 'n', type: 'single', prompt: '', ...partial }
}

describe('掌握分规则', () => {
  it('客观题：对 +30 / 错 -10', () => {
    expect(masteryDelta({ type: 'objective', correct: true })).toBe(30)
    expect(masteryDelta({ type: 'objective', correct: false })).toBe(-10)
  })

  it('简答：delta = (score-0.2)*50，满分+40、0.7分+25、零分-10', () => {
    expect(masteryDelta({ type: 'short', score: 1 })).toBe(40)
    expect(masteryDelta({ type: 'short', score: 0.7 })).toBe(25)
    expect(masteryDelta({ type: 'short', score: 0.2 })).toBe(0)
    expect(masteryDelta({ type: 'short', score: 0 })).toBe(-10)
    expect(masteryDelta({ type: 'short', score: 0.8 })).toBe(30)
  })

  it('手感：2 客观对 + 简答 0.7 = +85，稳稳越过 80 解锁线', () => {
    const total =
      masteryDelta({ type: 'objective', correct: true }) * 2 +
      masteryDelta({ type: 'short', score: 0.7 })
    expect(total).toBeGreaterThanOrEqual(80)
  })

  it('clamp 到 0~100', () => {
    expect(clampMastery(-5)).toBe(0)
    expect(clampMastery(105)).toBe(100)
    expect(clampMastery(52.4)).toBe(52)
  })
})

describe('客观题判分', () => {
  it('单选答案归一化：容忍小写/带文字', () => {
    expect(normalizeObjectiveAnswer('single', ' b ')).toBe('B')
    expect(normalizeObjectiveAnswer('single', 'B. 特征交叉')).toBe('B')
  })

  it('判断答案归一化：多种表述', () => {
    for (const v of ['对', '正确', '√', 'yes', 'T']) expect(normalizeObjectiveAnswer('judge', v)).toBe('对')
    for (const v of ['错', '错误', '×', 'no', 'F']) expect(normalizeObjectiveAnswer('judge', v)).toBe('错')
  })

  it('单选判分', () => {
    const question = q({ type: 'single', answer: 'B' })
    expect(gradeObjective(question, 'b').correct).toBe(true)
    expect(gradeObjective(question, 'C').correct).toBe(false)
  })

  it('判断判分', () => {
    const question = q({ type: 'judge', answer: '错' })
    expect(gradeObjective(question, '错误').correct).toBe(true)
    expect(gradeObjective(question, '对').correct).toBe(false)
  })
})
